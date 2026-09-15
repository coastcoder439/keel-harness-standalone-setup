import fs from 'node:fs/promises';
import path from 'node:path';

// Prueft den bereits fertigen Build, BEVOR materialisiert oder ein Sprachdienst
// gestartet wird. materializeStandaloneRuntime allein findet nur fehlende Dateien;
// hier faellt zusaetzlich ein veralteter standalone-Build gegen ein frisches .next
// auf (zwei verschiedene BUILD_ID), der sonst still eine alte Oberflaeche liefert.
export async function prepareProductionWeb(dashboard, materialize, { port = '4190', distDir = '.next' } = {}) {
  const build = path.join(dashboard, distDir);
  try {
    const [buildId, standaloneId, manifest] = await Promise.all([
      fs.readFile(path.join(build, 'BUILD_ID'), 'utf8'),
      fs.readFile(path.join(build, 'standalone', distDir, 'BUILD_ID'), 'utf8'),
      fs.readFile(path.join(build, 'required-server-files.json'), 'utf8').then(JSON.parse),
    ]);
    if (!buildId.trim() || buildId !== standaloneId || manifest.config?.output !== 'standalone') throw new Error('Buildkennung oder Standalone-Konfiguration stimmt nicht überein.');
    const runtime = materialize();
    return { ...runtime, args: [runtime.serverFile], cwd: runtime.runtimeRoot, env: { PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production', KEEL_ACCOUNTABILITY_NEXT_DIST_DIR: distDir } };
  } catch (error) {
    throw new Error(`Der Dashboard-Produktionsbuild fehlt oder ist unvollständig. Zuerst im Harness-Wurzelverzeichnis \`npm run build:dashboard\` ausführen. Kein Sprachdienst wurde gestartet. ${error.message}`);
  }
}
