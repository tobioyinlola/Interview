"use strict";
// Works out the note that goes with a new copy of the phone app's interface (the release called
// interface-latest): which version it is, and the oldest installed app (Android build number) that
// can run it. A phone that is older than that gets a full app update instead.
//
//   node scripts/ui-release.js <version> <build> <previous-note-json|""> <changed-files...>
//
// The interface needs a newer app only when something native changed since the last interface was
// published (the Android or iPhone project, the plugins, or the Capacitor config). Otherwise it can
// run on whatever the previous one ran on.

const NATIVE = [
  /^mobile\/android\//,
  /^mobile\/ios\//,
  /^mobile\/package(-lock)?\.json$/,
  /^mobile\/capacitor\.config\.ts$/,
];

/** The oldest build that can run the new interface. */
function nativeMin(previous, changedFiles, build) {
  const prev = previous && Number.isInteger(previous.native_min) ? previous.native_min : null;
  if (prev === null) return build; // the first one: only apps from this build on
  if (changedFiles === null) return build; // we cannot tell what changed, so be careful
  return changedFiles.some((f) => NATIVE.some((re) => re.test(f))) ? build : prev;
}

function note(version, build, previous, changedFiles, commit) {
  return { version, native_min: nativeMin(previous, changedFiles, build), commit };
}

module.exports = { nativeMin, note, NATIVE };

if (require.main === module) {
  const [version, build, prevJson, ...files] = process.argv.slice(2);
  let previous = null;
  try {
    previous = prevJson ? JSON.parse(prevJson) : null;
  } catch {
    previous = null;
  }
  const changed = files.length === 1 && files[0] === "UNKNOWN" ? null : files;
  process.stdout.write(
    JSON.stringify(note(version, Number(build), previous, changed, process.env.GITHUB_SHA || "")),
  );
}
