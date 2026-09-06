# Paketverweis: new-harness-setup-repo

Dieses Repo ist das **Artefakt** des Arbeitspakets `new-harness-setup-repo`.

Das Paket-Bundle selbst (OWNER.md, PACKAGE.md, GATES.md, gates/) lebt im Repo der
Werkbank, die dieses Setup-Repo erzeugt:

    harness-lab: docs/packages/new-harness-setup-repo/

Grund der Aufteilung: Die Arbeit gehört dem Repo, das die Quelle besitzt — der
Installer, die Payload und das Manifest hier entstehen reproduzierbar aus
`harness-lab/test-harness/standalone/` über `node scripts/build-payload.mjs`
(Quell-Commit des letzten Laufs: `payload-provenance.json`). Dieses Repo trägt
deshalb keinen zweiten Paketplan; wer den Stand des Pakets sucht, liest das
Bundle im harness-lab.
