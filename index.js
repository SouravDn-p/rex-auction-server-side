

require("dotenv").config()
const express = require("express")
const cors = require("cors")
const jwt = require("jsonwebtoken")
const cookieParser = require("cookie-parser")
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb")
const { Server } = require("socket.io")
const http = require("http")

const port = process.env.PORT || 5000
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173","https://rex-auction.web.app"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000, 
})

app.use(
  cors({
    origin: ["http://localhost:5173","https://rex-auction.web.app"],
    credentials: true,
  }),
)
app.use(express.json())
app.use(cookieParser())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_KEY}@cluster0.npxrq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    await client.connect()
    console.log("Connected to MongoDB")

    const db = client.db("rexAuction")
    const userCollection = db.collection("users")
    const auctionCollection = db.collection("auctionsList")
    const announcementCollection = db.collection("announcement")
    const SellerRequestCollection = db.collection("sellerRequest")
    const SpecificUserLiveBiddingCollection = db.collection("liveBids")
    const reportsCollection = db.collection("reports")
    const messagesCollection = db.collection("messages")

    // JWT Middleware
     const verifyToken = (req, res, next) => {
       const token = req?.cookies?.token || req.headers["authorization"]?.split(" ")[1]
       if (!token) return res.status(401).send({ message: "Unauthorized access" })
       jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
         if (err) return res.status(401).send({ message: "Unauthorized access" })
         req.decodedUser = decoded
         next()
       })
     }
 
     // Verify Admin Middleware
     const verifyAdmin = async (req, res, next) => {
       const email = req.decodedUser.email
       const query = { email: email }
       const user = await userCollection.findOne(query)
       const isAdmin = user?.role === "admin"
       if (!isAdmin) return res.status(401).send({ message: "Unauthorized request" })
       next()
     }
 
     // Verify Seller Middleware
     const verifySeller = async (req, res, next) => {
       const email = req.decodedUser.email
       const query = { email: email }
       const user = await userCollection.findOne(query)
       const isSeller = user?.role === "seller"
       if (!isSeller) return res.status(401).send({ message: "Unauthorized request" })
       next()
     }
 


 

    // Socket.IO Logic for Chat (Email-based)
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

          // Generate a unique message ID
          const messageId = new ObjectId().toString();

          const message = {
            messageId,
            senderId,
            receiverId,
            text,
            createdAt: new Date(),
          };

          // Check if the message already exists
          const existingMessage = await messagesCollection.findOne({
            messageId: message.messageId,
          });

          if (existingMessage) {
            if (callback) callback({ success: false, error: "Message already exists" });
            return;
          }

          // Save to database
          const result = await messagesCollection.insertOne(message);

          if (result.acknowledged) {
            // Emit to the chat room (both users)
            io.to(chatId).emit("receiveMessage", message);

            // Send acknowledgement back to sender
            if (callback) callback({ success: true, messageId: result.insertedId });

            console.log(`Message sent to room ${chatId}: ${text.substring(0, 20)}...`);
          } else {
            if (callback) callback({ success: false, error: "Failed to save message" });
          }
        } catch (error) {
          console.error("Error sending message:", error);
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

    // Chat API Endpoints
    app.get("/messages/email/:userEmail/:selectedUserEmail", verifyToken, async (req, res) => {
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
    });

    // Socket connection test endpoint
    app.get("/socket-test", (req, res) => {
      res.json({
        status: "Socket.IO server running",
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
      });
    });
    
    // JWT Routes
    app.post("/jwt", async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: "1d" })
      res.cookie("token", token, { httpOnly: true, secure: false }).send({ success: true })
    })

    app.post("/logout", (req, res) => {
      res.clearCookie("token", { httpOnly: true, secure: false }).send({ success: true })
    })

    // Seller Request APIs
    app.get("/sellerRequest/:becomeSellerStatus", async (req, res) => {
      try {
        const becomeSellerStatus = req.params.becomeSellerStatus
        const users = await SellerRequestCollection.find({ becomeSellerStatus }).toArray()
        if (!users.length) return res.status(404).json({ message: "Users not found" })
        res.json(users)
      } catch (error) {
        console.error("Error fetching seller requests:", error)
        res.status(500).json({ message: "Internal server error!" })
      }
    })

    app.get("/sellerRequest", async (req, res) => {
      try {
        const users = await SellerRequestCollection.find().toArray()
        res.send(users)
      } catch (error) {
        res.status(500).send("Internal server error!")
      }
    })

    app.post("/become_seller", async (req, res) => {
      const requestData = req.body
      const result = await SellerRequestCollection.insertOne(requestData)
      res.send({ success: true, result })
    })

    app.delete("/sellerRequest/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await SellerRequestCollection.deleteOne(query)
      if (result.deletedCount > 0) {
        res.send({ success: true, message: "Seller request deleted successfully!" })
      } else {
        res.status(404).send({ success: false, message: "Seller request not found!" })
      }
    })

    app.patch("/sellerRequest/:id", async (req, res) => {
      const userId = req.params.id
      const { becomeSellerStatus } = req.body
      if (!becomeSellerStatus) {
        return res.status(400).send({ success: false, message: "Status is required!" })
      }
      const updatedUser = await SellerRequestCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { becomeSellerStatus } },
      )
      if (updatedUser.modifiedCount > 0) {
        res.send({ success: true, message: "Seller status updated successfully!" })
      } else {
        res.status(404).send({ success: false, message: "Seller request not found!" })
      }
    })

    // User APIs
    app.get("/users", async (req, res) => {
      const users = await userCollection.find().toArray()
      res.send(users)
    })

    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email
        const user = await userCollection.findOne({ email })
        if (!user) return res.status(404).json({ message: "User not found" })
        res.json(user)
      } catch (error) {
        console.error("Error fetching user:", error)
        res.status(500).json({ message: "Internal server error!" })
      }
    })

    app.post("/users", async (req, res) => {
      const user = req.body
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query)
      if (existingUser) return res.status(201).send(existingUser)
      const result = await userCollection.insertOne(user)
      res.status(201).send(result)
    })

    app.patch("/users/:id", async (req, res) => {
      const userId = req.params.id
      const { role } = req.body
      if (!role) {
        return res.status(400).send({ success: false, message: "Role is required!" })
      }
      const updatedUser = await userCollection.updateOne({ _id: new ObjectId(userId) }, { $set: { role } })
      if (updatedUser.modifiedCount > 0) {
        res.send({ success: true, message: "User role updated successfully!" })
      } else {
        res.status(404).send({ success: false, message: "User not found or role not changed!" })
      }
    })

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      if (result.deletedCount > 0) {
        res.send({ success: true, message: "User deleted successfully!" })
      } else {
        res.status(404).send({ success: false, message: "User not found!" })
      }
    })

    // Announcement APIs
    app.get("/announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray()
      res.send(result)
    })

    app.post("/announcement", async (req, res) => {
      const announcementData = req.body
      const result = await announcementCollection.insertOne(announcementData)
      res.send({ success: true, result })
    })

    app.delete("/announcement/:id", async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const result = await announcementCollection.deleteOne(filter)
      res.send(result)
    })

    app.put("/announcement/:id", async (req, res) => {
      const { title, content, date, image } = req.body
      const announcementId = req.params.id
      try {
        const result = await announcementCollection.updateOne(
          { _id: new ObjectId(announcementId) },
          { $set: { title, content, date, image } },
        )
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Announcement not found" })
        }
        res.status(200).json({ message: "Announcement updated successfully" })
      } catch (error) {
        console.error(error)
        res.status(500).json({ message: "Failed to update the announcement" })
      }
    })

    // Auction APIs
    app.get("/auction/:id", async (req, res) => {
      const { id } = req.params
      try {
        const query = { _id: new ObjectId(id) }
        const result = await auctionCollection.findOne(query)
        res.send(result)
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch Auction", error })
      }
    })

    app.get("/auctions", async (req, res) => {
      try {
        const { email } = req.query
        if (email) {
          const auctions = await auctionCollection.find({ sellerEmail: email }).toArray()
          res.send(auctions)
        } else {
          const result = await auctionCollection.find().toArray()
          res.send(result)
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error })
      }
    })

    app.post("/auctions", async (req, res) => {
      const auction = req.body
      const result = await auctionCollection.insertOne(auction)
      res.send(result)
    })

    app.patch("/auctions/:id", async (req, res) => {
      const auctionId = req.params.id
      const { status } = req.body
      const filter = { _id: new ObjectId(auctionId) }
      const updateDoc = { $set: { status } }
      const result = await auctionCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    app.delete("/auctions/:id", async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const result = await auctionCollection.deleteOne(filter)
      res.send(result)
    })

    // Live Bidding APIs
    app.get("/live-bid/top", async (req, res) => {
      const { auctionId } = req.query
      const query = auctionId ? { auctionId } : {}
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
      ]).toArray()
      res.send(result)
    })

    app.get("/live-bid/recent", async (req, res) => {
      const { auctionId } = req.query
      const query = auctionId ? { auctionId } : {}
      const result = await SpecificUserLiveBiddingCollection.find(query).sort({ createdAt: -1 }).limit(3).toArray()
      res.send(result)
    })

    app.post("/live-bid", async (req, res) => {
      const liveBid = req.body
      liveBid.createdAt = new Date()
      const result = await SpecificUserLiveBiddingCollection.insertOne(liveBid)
      await auctionCollection.updateOne(
        { _id: new ObjectId(liveBid.auctionId) },
        { $set: { currentBid: liveBid.amount } },
      )
      res.send(result)
    })

    // Reports API
    app.post("/reports", async (req, res) => {
      const reports = req.body
      const result = await reportsCollection.insertOne(reports)
      res.send({ success: true, result })
    })

    // Debug endpoint to check active socket connections
    app.get("/debug/socket-connections", (req, res) => {
      const connections = Array.from(io.sockets.sockets).map(([id, socket]) => ({
        id,
        rooms: Array.from(socket.rooms),
      }))

      res.json({
        activeConnections: connections.length,
        connections,
      })
    })
  } finally {
   
  }
}
run().catch(console.dir)

app.get("/", (req, res) => {
  res.send("RexAuction Running with Socket.IO!")
})

server.listen(port, () => {
  console.log(`Running on port ${port}`)
})

