// Where the demo decides on a submission. `npm run demo` sends each form to the
// demo server, which decides. The static copy published on a website has no
// server, so its deployment sets this to true and the browser decides instead,
// with the same code (demo/decide.js).
export const DECIDE_IN_BROWSER = false;
