"use strict";
// Shown when the site cannot be reached, with a button to try again.
function offlinePage(appUrl) {
  const html = `<!doctype html><meta charset="utf-8"><title>InterviewMeet</title>
<style>body{font:16px system-ui,sans-serif;background:#f7f4ff;color:#1b1830;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:26rem;text-align:center;padding:1.5rem}h1{font-size:1.5rem}p{color:#5e5c75}
button{font:inherit;background:#7b47f3;color:#fff;border:0;border-radius:12px;padding:.7rem 1.4rem;cursor:pointer}</style>
<main><h1>You are offline</h1><p>InterviewMeet could not reach the internet. Check your connection and try again.</p>
<button onclick="location.href='${appUrl.replace(/'/g, "")}'">Try again</button></main>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}
module.exports = { offlinePage };
