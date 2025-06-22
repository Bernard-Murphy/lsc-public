// const express = require("express");
// const http = require("http");
// const ioServer = require("socket.io");

// const app = express();
// const server = http.createServer(app);
// const port = 65531;
// ioServer(server).on("connection", (connection) => {
//   console.log("new connection");
// });

// server.listen(port, () =>
//   console.log("test socket server running on port", port)
// );
// const crypto = require("crypto");
// console.log(crypto.randomBytes(16).toString("hex"));

let user = {
  username: "lilmilk@hq.dhs.gov",
};
user.component = user.username.split("@")[1];
const split = user.component.split(".");
if (split[0].toLowerCase() === "associates") user.component = split[1];
else user.component = split[0];

console.log(user);
