const { io } = require("socket.io-client");
const express = require("express");
const { v4: uuid } = require("uuid");
const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
const crypto = require("crypto");

const port = process.env.PORT;
const socketKey = process.env.SOCKET_KEY;
const socketHost = process.env.SOCKET_HOST;
const maxStreamConnections = Number(process.env.MAX_STREAM_CONNECTIONS);
const peerID = uuid();
const app = express();
let browser;
let page;
const logID = crypto.randomBytes(8).toString("hex");

/**
 * Depth starts at 1
 * Depth only set by parent on bump
 * Directly connected to main, depth = main - 1
 * All others, relative to nearest 1
 * Check for open connectors with same hostID and depth > 1
 * If found, connect to that one
 *
 * If receive "bump" signal:
 * * Remove all peers
 * * Connect to bump peerID
 *
 * If receive connection from
 */

const mongoUrl =
  "mongodb+srv://" +
  process.env.MONGO_USER +
  ":" +
  encodeURIComponent(process.env.MONGO_PASSWORD) +
  "@" +
  process.env.MONGO_HOST +
  "/?retryWrites=true&w=majority";

const client = new MongoClient(mongoUrl);
const StreamClients = client.db("sessionServer").collection("streamClients");

const killBrowser = () => {
  try {
    console.log("kill");
    if (browser && browser.close) browser.close();
  } catch (err) {
    console.log("Kill browser error", err);
  }
};

const bump = async (hostPeer, depth) => {
  try {
    await StreamClients.updateMany(
      {
        "clients.peerID": peerID,
      },
      {
        $pull: {
          clients: {
            peerID,
          },
        },
      }
    );
    await StreamClients.updateOne(
      {
        peerID: hostPeer,
      },
      {
        $push: {
          clients: {
            timestamp: new Date(),
            peerID,
            depth,
          },
        },
      }
    );
  } catch (err) {
    console.log("bump error", err);
  }
};

const removePeers = async (depth) => {
  try {
    await StreamClients.updateOne(
      {
        peerID,
      },
      {
        $pull: {
          clients: {
            depth: null,
          },
        },
        $set: {
          depth: Number(depth),
        },
      }
    );
    await StreamClients.updateOne(
      {
        "clients.peerID": peerID,
      },
      {
        $set: {
          "clients.$[client].depth": depth,
        },
      },
      {
        arrayFilters: [
          {
            "client.peerID": peerID,
          },
        ],
      }
    );
  } catch (err) {
    console.log("removePeers error", err);
  }
};

const socket = io(socketHost, {
  query: {
    socketKey,
    peerID,
  },
  transports: ["websocket"], // or [ "websocket", "polling" ] (the order matters)
});

socket.on("add-client", async (peerID) => {
  try {
    // console.log("add client", peerID);
    await page.type("#peer", peerID);
    await page.click("#add");
  } catch (err) {
    console.log("add client error", err);
  }
});

socket.on("remove-client", async (peerID) => {
  try {
    // console.log("remove-client", peerID);
    await page.type("#disconnect", peerID);
    await page.click("#remove");
  } catch (err) {
    console.log("remove-client error", err);
  }
});

socket.on("init", async (details) => {
  try {
    console.log("init", details);
    let { hostPeerID, firstPeer, instanceID, userID } = details;
    const StreamLogs = client.db(instanceID).collection("streamLogs");

    await StreamLogs.insertOne({
      _id: logID,
      type: "child",
      userID,
      instanceID,
      start: new Date(),
    });

    socket.on("kill", async () => {
      try {
        // console.log("socket kill");
        killBrowser();
        await StreamLogs.updateOne(
          {
            _id: logID,
          },
          {
            $set: {
              end: new Date(),
            },
          }
        );
      } catch (err) {
        console.log("kill error", err);
      }
    });
    // console.log("details", details);

    const getCurrentHost = async (depth) => {
      try {
        // const test = await StreamClients.find().toArray();
        // console.log("test", test);
        let openConnector = await StreamClients.find({
          hostID: userID,
          [`clients.${maxStreamConnections - 1}`]: {
            $exists: false,
          },
          depth: {
            $gt: 1,
          },
          peerID: {
            $ne: peerID,
          },
        })
          .sort({
            depth: 1,
          })
          .limit(1)
          .toArray();
        openConnector = openConnector[0];
        if (openConnector) {
          // console.log("host is openConnector");
          StreamClients.updateOne(
            {
              _id: openConnector._id,
            },
            {
              $push: {
                clients: {
                  timestamp: new Date(),
                  peerID,
                  depth: 1,
                },
              },
            }
          );
          return {
            peer: openConnector.peerID,
            centralClient: false,
          };
        }
      } catch (err) {
        console.log("get streamer error", err);
      }

      // console.log("host is main");
      return {
        peer: hostPeerID,
        centralClient: true,
      };
    };
    const currentHost = await getCurrentHost();
    hostPeerID = currentHost.peer;
    // console.log("init", hostPeerID, firstPeer);

    const html = `
            <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta http-equiv="X-UA-Compatible" content="IE=edge">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Document</title>
                    <script>let exports = {};</script>
                    <script src="${process.env.FILE_HOST}/scripts/peerjs.newest.js"></script>
                </head>
                <body>
                    <audio autoplay controls id="player"></audio>
                    <video name="video_download" id="video_download" autoplay controls></video>
                    <input id="peer"/>
                    <input id="disconnect" />
                    <button id="add">add</button>
                    <button id="start">start</button>
                    <button id="remove">remove</button>
                </body>
                </html>
            `;
    browser = await puppeteer.launch({
      args: ["--single-process", "--no-zygote", "--no-sandbox"],
    });

    page = await browser.newPage();

    await page.setJavaScriptEnabled(true);
    await page.setContent(html, {
      waitLoad: true,
      waitNetworkIdle: true,
    });
    await page.exposeFunction("removePeers", removePeers);
    /**
     * Passes environment and other outside variables into browser context
     */
    await page.exposeFunction("getEnv", (variable) => {
      switch (variable) {
        case "peerHost":
          return process.env.PEER_HOST;
        case "peerPort":
          return process.env.PEER_PORT;
        case "peerID":
          return peerID;
        case "hostPeerID":
          return hostPeerID;
        case "instanceID":
          return instanceID;
        case "userID":
          return userID;
        case "firstPeer":
          return firstPeer;
        case "childKey":
          return process.env.CHILD_KEY;
        default:
          console.log("Oob env variable", variable);
          return "";
      }
    });

    /**
     * Forcibly closes the browser
     */
    await page.exposeFunction("killBrowser", killBrowser);

    await page.exposeFunction("getCurrentHost", getCurrentHost);

    await page.exposeFunction("freeClients", async () => {
      try {
        await StreamClients.updateMany(
          {
            hostID: {
              $ne: false,
            },
            clients: {
              $size: 0,
            },
          },
          {
            $set: {
              hostID: false,
            },
          }
        );
      } catch (err) {
        console.log("freeClients error", err);
      }
    });

    await page.exposeFunction("bump", bump);

    page.on("console", (message) => console.log(message.text()));

    await page.click("#start"); // Initializes the peer connection

    await page.evaluate(async () => {
      try {
        let mainConnection;
        let closeCall = false;
        let stream;
        let metadata = {};
        let peers = [];
        let streamViewers = [];
        const kickedConnections = [];
        let depth = 1;
        const peerHost = await window.getEnv("peerHost");
        const peerPort = await window.getEnv("peerPort");
        const peerID = await window.getEnv("peerID");
        const firstPeer = await window.getEnv("firstPeer");
        let hostPeerID = await window.getEnv("hostPeerID");
        const childKey = await window.getEnv("childKey");
        const peer = new Peer(peerID, {
          host: peerHost,
          port: peerPort,
          secure: Number(peerPort) === 443,
        });
        let clip = false;
        let callsInitiated = false;
        let waitingForConnection = false;
        let limboConnections = [];
        if (firstPeer) limboConnections.push({ peer: firstPeer });
        // console.log("This peer", peerID);
        // console.log("First", firstPeer);

        const closePeers = async () => {
          try {
            // console.log("closePeers", mainConnection);
            await window.freeClients();
            if (
              mainConnection &&
              typeof mainConnection !== "undefined" &&
              typeof mainConnection.close !== "undefined"
            ) {
              mainConnection.close();
            }

            if (closeCall) closeCall();
            peers = peers.filter((peer) => {
              // console.log("terminated, closing", peer.peer);
              try {
                if (peer?.close) peer.close();
                if (peer?.peerConnection?.close) peer.peerConnection.close();
              } catch (err) {
                console.log("terminate error", String(err));
              }
              return false;
            });
            window.killBrowser();
          } catch (err) {
            console.log("Close peers error", String(err));
          }
        };

        const resetConnection = async (bumped, viewers) => {
          try {
            waitingForConnection = false;
            // console.log("connection hanging", userID, instanceID);
            if (
              mainConnection &&
              typeof mainConnection !== "undefined" &&
              typeof mainConnection.close !== "undefined"
            ) {
              mainConnection.close();
            }
            const currentHost = await window.getCurrentHost();
            hostPeerID = currentHost.peer;
            centralClient = currentHost.centralClient;
            // console.log("updated peer", hostPeerID);
            if (hostPeerID) setMainConnection(bumped, viewers);
            else closePeers();
          } catch (err) {
            console.log("resetConnection error", String(err));
          }
        };

        const filterAndTerminate = (childPeer) => {
          // console.log("terminated, closing", peer.peer);
          try {
            // console.log("kicking", childPeer.peer);
            kickedConnections.push(
              peer.connect(childPeer.peer, {
                metadata: {
                  kick: true,
                },
              })
            );
            if (childPeer?.close) childPeer.close();
            if (childPeer?.peerConnection?.close)
              childPeer.peerConnection.close();
          } catch (err) {
            console.log("terminate error", String(err));
          }
          return false;
        };

        const setMainConnection = (bumped, viewers) => {
          // console.log("set main", bumped, viewers);
          try {
            if (
              mainConnection &&
              typeof mainConnection !== "undefined" &&
              typeof mainConnection.close !== "undefined"
            ) {
              mainConnection.close();
            }
            // console.log("closed main");
            mainConnection = peer.connect(hostPeerID, {
              metadata: {
                childKey,
                depth,
                bumped,
                viewers,
              },
            });
            mainConnection.on("data", async (data) => {
              try {
                console.log("data", JSON.stringify(data));
                if (data.childKey === childKey) {
                  if (data.bump) {
                    // console.log("bump", peers.length, limboConnections.length);
                    depth = Number(data.depth) - 1;
                    await window.removePeers(depth);
                    peers = peers.filter(filterAndTerminate);
                    limboConnections =
                      limboConnections.filter(filterAndTerminate);
                    peer.connect(data.bump, {
                      metadata: {
                        childKey,
                        bump: true,
                      },
                    });
                  }
                } else if (
                  ["device-change", "device-change-child"].includes(data.event)
                ) {
                  console.log("device change");
                  Array.from(peer._connections)
                    .map((c) => c[1][0])
                    .filter((connection) => {
                      return connection._eventsCount;
                    })
                    .forEach((connection) => {
                      connection.send({
                        ...data,
                        event: "device-change-child",
                      });
                    });
                }
              } catch (err) {
                console.log("data error", String(err));
              }
            });
            // mainConnection.on("close", () =>
            //   console.log("mainConnection closed")
            // );
            waitingForConnection = true;
            setTimeout(() => {
              if (waitingForConnection) {
                resetConnection(bumped, viewers);
              }
            }, 4000);
          } catch (err) {
            console.log("open error", String(err));
            closePeers();
          }
        };

        const setViewers = (viewers) => {
          try {
            if (!viewers) {
              const viewers = peers.length;
              mainConnection.send({
                event: "viewers",
                viewers: viewers,
              });
              if (!viewers) {
                setTimeout(closePeers, 1000);
              }
            } else {
              let found = false;
              streamViewers = streamViewers.map((sv) => {
                if (sv.peerID === viewers.peerID) {
                  found = true;
                  return viewers;
                }

                return sv;
              });

              if (!found) streamViewers.push(viewers);
              mainConnection.send({
                event: "viewers",
                viewers: streamViewers.reduce(
                  (prev, curr) => prev + curr.viewers,
                  0
                ),
              });
            }
          } catch (err) {
            console.log("setViewers error", String(err));
          }
        };

        const disconnectPeer = (peerID) => {
          try {
            const disconnect = (peer) => {
              try {
                if (peer.peer === peerID) {
                  // console.log("hit");
                  if (peer?.close) peer.close();
                  if (peer?.peerConnection?.close) peer.peerConnection.close();
                  return false;
                }

                return true;
              } catch (err) {
                console.log("filter error", String(err));
                return false;
              }
            };
            peers = peers.filter(disconnect);
            limboConnections = limboConnections.filter(disconnect);
            if (depth === 1) setViewers();
            else
              setViewers({
                peerID,
                viewers: 0,
              });
          } catch (err) {
            console.log("disconnectPeer error", peerID, String(err));
          }
        };

        document.getElementById("remove").addEventListener("click", () => {
          try {
            const peerID = document.getElementById("disconnect").value;
            document.getElementById("disconnect").value = "";
            // console.log("peerID", peerID);
            disconnectPeer(peerID);
          } catch (err) {
            console.log("Remove error", String(err));
          }
        });

        const processPeer = (peerID, peerDepth) => {
          // console.log("processing", peerID, peerDepth);
          if (stream) {
            const childConnection = peer.connect(peerID, {
              metadata: {
                fromStreamChild: true,
              },
            });
            childConnection.on("open", () => {
              try {
                childConnection.on("data", (data) => {
                  try {
                    if (data.ready) {
                      const call = peer.call(peerID, stream, {
                        metadata,
                      });
                      call.peerConnection.oniceconnectionstatechange = () => {
                        try {
                          // console.log(peerID, call.peerConnection.iceConnectionState);
                          if (
                            ["failed", "disconnected"].indexOf(
                              call.peerConnection.iceConnectionState
                            ) > -1 &&
                            depth !== 1
                          )
                            disconnectPeer(peerID);
                          else if (depth === 1) setViewers();
                        } catch (err) {
                          console.log("ice state change error", String(err));
                        }
                      };
                      peers.push({
                        peer: peerID,
                        peerConnection: call.peerConnection,
                        close: call.close,
                        depth: peerDepth,
                      });
                    }
                  } catch (err) {
                    console.log("childConnection data error", err);
                  }
                });
              } catch (err) {
                console.log("childConnection open error", err);
              }
            });
          } else {
            // console.log("no stream - adding limbo", peerID);
            limboConnections.push({
              peer: peerID,
              depth: peerDepth,
            });
          }
        };

        document.getElementById("add").addEventListener("click", () => {
          try {
            const peerID = document.getElementById("peer").value;
            document.getElementById("peer").value = "";
            // console.log("adding", peerID);
            processPeer(peerID);
          } catch (err) {
            console.log("Remove error", String(err));
          }
        });

        /**
         * When peer server connection established, make p2p connection with the streamaer
         */
        peer.on("open", setMainConnection);

        peer.on("call", (call) => {
          try {
            if (call.peer === hostPeerID) {
              metadata = call.metadata;
              if (closeCall) closeCall();
              waitingForConnection = false;
              call.answer();
              // closeCall = call.close;

              /**
               *
               * @param {MediaStream} track - The streamer's media stream
               *
               */
              call.peerConnection.ontrack = (track) => {
                // console.log("track", track.track.kind);
                try {
                  if (clip && stream) {
                    clip = false;
                    stream.getTracks().forEach((track) => {
                      track.stop();
                      stream.removeTrack(track);
                    });
                  }
                  if (!stream) {
                    stream = new MediaStream(track.streams[0]);
                    // Try without thiis
                    document.getElementById("player").srcObject = stream;
                    document.getElementById("player").play();
                  } else {
                    limboConnections.forEach((peer) => processPeer(peer.peer));
                    limboConnections = [];
                    if (!callsInitiated) {
                      // console.log("initiating", limboConnections[0].peer);
                      stream.addTrack(track.track);
                      callsInitiated = true;
                    } else {
                      peers.forEach((peer) => {
                        peer.peerConnection.getSenders().forEach((sender) => {
                          if (sender.track.kind === track.track.kind) {
                            sender.replaceTrack(track.track);
                          }
                        });
                      });
                    }
                  }
                } catch (err) {
                  console.log("track error", String(err));
                }
              };
            } else {
              // console.log("peer mismatch", call.peer, hostPeerID);
              call.close();
            }
          } catch (err) {
            console.log("call error", String(err));
          }
        });

        /**
         * When viewers initiate p2p connection with the server, call peers with new stream
         */
        peer.on("connection", async (connection) => {
          try {
            // console.log(
            //   "connection",
            //   connection.peer,
            //   JSON.stringify(connection.metadata)
            // );

            if (connection?.metadata?.fromStreamChild) {
              connection.on("open", () => {
                try {
                  connection.on("data", (data) => {
                    try {
                      if (
                        ["device-change", "device-change-child"].includes(
                          data.event
                        )
                      ) {
                        // replicate
                        Array.from(peer._connections)
                          .map((c) => c[1][0])
                          .filter((connection) => {
                            return connection._eventsCount;
                          })
                          .forEach((connection) => {
                            connection.send({
                              ...data,
                              event: "device-change-child",
                            });
                          });
                      }
                    } catch (err) {
                      console.log("connection data error", err);
                    }
                  });
                  connection.send({
                    ready: true,
                  });
                } catch (err) {
                  console.log("streamChild open error", err);
                }
              });
            } else if (connection.metadata?.childKey !== childKey) {
              // Connection from viewer
              if (depth === 1) {
                if (stream) {
                  processPeer(connection.peer);
                } else {
                  // console.log("limbo");
                  limboConnections.push({
                    peer: connection.peer,
                  });
                }
              } else console.log("Illegal connection - Viewer to non-depth 1");
            } else if (connection.metadata?.depth) {
              // Connection from child connector
              // console.log(
              //   "child",
              //   depth,
              //   connection.metadata?.depth,
              //   JSON.stringify(peers)
              // );
              if (peers.length) {
                const peerToBump = peers.find(
                  (peer) => peer.depth && Number(peer.depth) !== depth - 1
                );
                if (peerToBump) {
                  // If peer with depth that is not self-1, bump new connection to old
                  // console.log("peerToBump", JSON.stringify(peerToBump));
                  setTimeout(() => {
                    connection.send({
                      childKey,
                      bump: peerToBump.peer,
                      depth,
                    });
                  }, 100);
                  const filterPeerToBump = (peer) => {
                    if (peer.peer === peerToBump.peer) {
                      try {
                        // console.log("disconnected, closing", peer.peer);
                        if (peer?.close) peer.close();
                        if (peer?.peerConnection?.close)
                          peer.peerConnection.close();
                      } catch (err) {
                        console.log("disconnect error", String(err));
                      }
                      return false;
                    }

                    return true;
                  };
                  peers = peers.filter(filterPeerToBump);
                  limboConnections = limboConnections.filter(filterPeerToBump);
                  streamViewers = streamViewers.filter(
                    (sv) => sv.peerID !== peerToBump.peer
                  );
                }
              }
              connection.on("data", async (data) => {
                try {
                  // console.log(
                  //   "data from child",
                  //   connection.peer,
                  //   JSON.stringify(data)
                  // );
                  if (data.event === "viewers") {
                    setViewers({
                      peerID: connection.peer,
                      viewers: Number(data.viewers),
                    });
                  }
                } catch (err) {
                  console.log("Set RTC session error", String(err));
                }
              });
              if (connection.metadata?.viewers)
                setViewers({
                  peerID: connection.peer,
                  viewers: Number(connection.metadata.viewers),
                });
              if (stream) {
                processPeer(connection.peer, connection.metadata?.depth);
              } else {
                // console.log("limbo");
                limboConnections.push({
                  peer: connection.peer,
                  depth: connection.metadata?.depth,
                });
              }
            } else {
              // Connection from host
              if (connection.metadata?.bump) {
                // console.log("bumped", connection.peer);
                await window.bump(connection.peer, depth);
              }
              hostPeerID = connection.peer;
              const viewers =
                depth === 1
                  ? peers.length
                  : streamViewers.reduce(
                      (prev, curr) => prev + curr.viewers,
                      0
                    );
              // console.log("viewers", viewers, depth);
              setMainConnection(
                connection.metadata?.bump ? true : false,
                viewers
              );
            }
          } catch (err) {
            console.log("Connection error", String(err));
          }
        });
      } catch (err) {
        console.log("error", String(err));
        closePeers();
      }
    });
  } catch (err) {
    console.log("Init error", err);
  }
});

app.listen(port, () => {
  console.log("Stream child running on port", port, "with peer", peerID);
  console.log("socket host", process.env.SOCKET_HOST);
});
