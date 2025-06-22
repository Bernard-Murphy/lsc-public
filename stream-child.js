const { spawn } = require("child_process");
const app = require("express")();
require("dotenv").config();

console.log(process.env.CLUSTER_COUNT);
const port = process.env.MAIN_PORT;
const clusterCount = Number(process.env.CLUSTER_COUNT);
const servicePorts = Array.from(Array(clusterCount).keys()).map(
  (n) => 3200 + n
);

const children = [];

process.on("exit", () => {
  console.log("Exiting...");
  children.forEach((child) => child.kill());
  console.log("Child processes killed");
});

servicePorts.forEach((port) => {
  const child = spawn("node", ["instance.js"], {
    env: {
      ...process.env,
      PORT: port,
    },
  });
  child.stdout.on("data", (data) => {
    console.log(`${port} stdout:\n${data}`);
  });
  child.stderr.on("data", (data) => {
    console.log(`${port} stderr: ${data}`);
  });
  child.on("exit", (code) => {
    console.log(`${port} Process ended with ${code}`);
  });
  children.push(child);
});

app.listen(port, () =>
  console.log("Stream child cluster running on port", port)
);
