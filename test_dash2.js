const http = require("http");
http.get("http://localhost:5000/api/monitoring/ground-stations/dashboard?timeRange=15m", (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    try {
      const j = JSON.parse(data);
      console.log("Success:", j.success);
      if (j.error) console.log("Error:", j.error);
      else console.log("Regions:", j.dashboard.regions.length);
    } catch(e) { console.log(data); }
  });
});
