// Loading js-aruco2. It is a classic script: it puts its objects CV and AR on
// `this`, and has no ES exports, so a bundler sees nothing to import (and
// drops it). We load its two files as text and run them with a `this` of our
// own, which works the same in the browser, in the worker and in the tests.

import arucoSource from "js-aruco2/src/aruco.js?raw";
import cvSource from "js-aruco2/src/cv.js?raw";

const scope: { CV?: unknown; AR?: unknown } = {};
new Function("require", cvSource).call(scope, () => ({}));
new Function("require", arucoSource).call(scope, () => ({ CV: scope.CV }));

if (scope.AR === undefined || scope.CV === undefined) {
  throw new Error("js-aruco2 did not load.");
}

export const AR: unknown = scope.AR;
export const CV: unknown = scope.CV;
