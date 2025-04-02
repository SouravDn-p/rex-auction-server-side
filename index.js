require("dotenv").config();
const express = require("express");
const cors = require("cors");
var jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;

const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const req = require("express/lib/request");
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
    console.log(
      "connected to mongodb"
      // process.env.DB_USER,
      // process.env.DB_KEY
    );

    const db = client.db("rexAuction");
    const userCollection = db.collection("users");
    const auctionCollection = db.collection("auctionsList");
    const announcementCollection = db.collection("announcement");
    const SellerRequestCollection = db.collection("sellerRequest");

    // JWT

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN, {
        expiresIn: "1d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
      // res.send(token);
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
    });

    // Auth Middleware
    const verifyToken = (req, res, next) => {
      console.log("inside the verifyToken ~", req.cookies);
      const token = req?.cookies?.token;
      if (!token) {
        return res.status(401).send({ message: "UnAuthorize access" });
      }
      jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "UnAuthorize access" });
        }
        req.decodedUser = decoded;
        next();
      });
    };

    // const verifyToken = (req, res, next) => {
    //   console.log("inside verify token", req.headers.authorization);
    //   if (!req.headers.authorization) {
    //     return res.status(401).send({ message: "unauthorized request" });
    //   }
    //   const token = req.headers.authorization.split(" ")[1];
    //   jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
    //     if (error) {
    //       return res.status(403).send({ message: "forbidden access" });
    //     }
    //     req.decoded = decoded;
    //     next();
    //   });
    // };

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(401).send({ message: "unauthorized request" });
      }
      next();
    };

    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isSeller = user?.role === "seller";
      if (!isSeller) {
        return res.status(401).send({ message: "unauthorized request" });
      }
      next();
    };

    // seller request apis

    // seller request apis
    app.get("/sellerRequest", async (req, res) => {
      try {
        const users = SellerRequestCollection.find();
        const collections = await users.toArray();
        res.send(collections);
      } catch (error) {
        res.status(201).send("internal server error!");
      }
    });

    // Seller Request info save in db
    app.post("/become_seller", async (req, res) => {
      const requestData = req.body;
      console.log(requestData);
      const result = await SellerRequestCollection.insertOne(requestData);
      res.send({ success: true, result });
    });

    app.delete("/sellerRequest/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await SellerRequestCollection.deleteOne(query);

      if (result.deletedCount > 0) {
        res.send({ success: true, message: "User deleted successfully!" });
      } else {
        res.status(404).send({ success: false, message: "User not found!" });
      }
    });

    // user data save in db

    // get all users api
    app.get("/users", async (req, res) => {
      const email = req.query.email;
      const users = userCollection.find();
      // if (email != req.decodedUser.email) {
      //   return res.status(403).send({ message: "forbidden  access" });
      // }
      const collections = await users.toArray();
      res.send(collections);
    });

    app.get("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email: email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Internal server error!" });
      }
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // Check if the user already exists based on email
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.status(201).send(existingUser);
      }
      // Save the new user
      const result = await userCollection.insertOne(user);
      res.status(201).send(result);
    });

    // Update user profile
    app.patch("/user/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const updatedData = req.body;

        delete updatedData._id;

        const result = await userCollection.updateOne(
          { email: email },
          { $set: updatedData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        // Get and return the updated user document
        const updatedUser = await userCollection.findOne({ email: email });
        res.json(updatedUser);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ message: "Internal server error!" });
      }
    });

    // Specific user role update

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

    // Announcement Related apis

    // get all announcement

    app.get("/announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    // Save Announcement Data in DB
    app.post("/announcement", async (req, res) => {
      const announcementData = req.body;
      const result = await announcementCollection.insertOne(announcementData);
      res.send({ success: true, result });
    });

    // Announcement Delete api
    app.delete("/announcement/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      const result = await announcementCollection.deleteOne(filter);
      res.send(result);
    });

    //  update announcement api
    app.put("/announcement/:id", async (req, res) => {
      const { title, content, date, image } = req.body;
      const announcementId = req.params.id;

      try {
        const result = await announcementCollection.updateOne(
          { _id: new ObjectId(announcementId) },
          {
            $set: {
              title,
              content,
              date,
              image,
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Announcement not found" });
        }

        res.status(200).json({
          message: "Announcement updated successfully",
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to update the announcement" });
      }
    });

    // Auction related apis

    // get all auctions
    app.get("/auctions", async (req, res) => {
      try {
        const result = await auctionCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    app.get("/auction/:id", async (req, res) => {
      const { id } = req.params;
      try {
        const query = { _id: new ObjectId(id) };
        const result = await auctionCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch Auctions", error });
      }
    });

    app.get("/auctions/:email", async (req, res) => {
      const { email } = req.params;
      const auctions = await auctionCollection
        .find({ sellerEmail: email })
        .toArray(); // Assuming sellerEmail stores the email
      res.send(auctions);
    });

    app.post("/auctions", async (req, res) => {
      const auction = req.body;
      const result = await auctionCollection.insertOne(auction);
      res.send(result);
    });

    app.patch("/auctions/:id", async (req, res) => {
      const auctionId = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(auctionId) };
      const updateDoc = {
        $set: {
          status, // Update only the status field
        },
      };
      const result = await auctionCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("RexAuction Running!");
});

app.listen(port, () => {
  console.log(`running in port ${port}`);
});
