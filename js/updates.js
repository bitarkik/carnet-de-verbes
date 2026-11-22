// Run independently of notebook parsing so recovery remains possible after a load error.
if ("serviceWorker" in navigator) {
  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js?v=33", { updateViaCache: "none" });
      await registration.update();
    } catch { /* Offline: continue using the installed app. */ }
  };
  start();
  window.addEventListener("online", start);
}
