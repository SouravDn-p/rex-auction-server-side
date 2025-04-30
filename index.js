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
    };

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
          res
            .status(201)
            .json({
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
        res
          .status(500)
          .json({
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
