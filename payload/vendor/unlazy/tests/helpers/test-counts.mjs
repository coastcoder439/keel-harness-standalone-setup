export class SkippedTest extends Error {
  constructor(reason) {
    super(reason);
    this.name = "SkippedTest";
  }
}

export function skipTest(reason) {
  throw new SkippedTest(reason);
}

export function emitTestCounts(suite, counts) {
  const value = {
    schema: 1,
    suite,
    tests: Number(counts.tests),
    pass: Number(counts.pass),
    fail: Number(counts.fail),
    skip: Number(counts.skip),
  };
  for (const [name, count] of Object.entries(value).slice(2)) {
    if (!Number.isInteger(count) || count < 0) throw new Error(`invalid ${name} count for ${suite}: ${count}`);
  }
  if (value.pass + value.fail + value.skip !== value.tests) {
    throw new Error(`inconsistent test counts for ${suite}: ` + JSON.stringify(value));
  }
  console.log("UNLAZY_TEST_COUNTS " + JSON.stringify(value));
  return value;
}
