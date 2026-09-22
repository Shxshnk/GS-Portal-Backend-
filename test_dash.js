const http = require("http");
http.get("http://localhost:5000/api/monitoring/ground-stations/dashboard", (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    try {
      const j = JSON.parse(data);
      console.log(j.success);
      if (j.error) console.log(j.error);
    } catch(e) { console.log(data); }
  });
});
