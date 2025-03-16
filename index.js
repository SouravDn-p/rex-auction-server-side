require("dotenv").config();
var jwt = require("jsonwebtoken");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json());

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "UnAuthorize access" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "UnAuthorize access" });
    }
    req.decodedUser = decoded;
    next();
  });
};
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_KEY}@cluster0.pb8np.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const db = client.db("rexAuction");
    const userCollection = db.collection("users");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, `${process.env.JWT_SECRET}`, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
    });

    app.get("/users", async (req, res) => {
      try {
        const users = userCollection.find();
        const collections = await users.toArray();
        res.send(collections);
      } catch (error) {
        res.status(201).send("internal server error!");
      }
    });

    app.post("/user", async (req, res) => {
      try {
        const { displayName, email } = req.body;
        const newUser = { displayName, email, role: "user" };
        if (!email || !displayName) {
          return res
            .status(400)
            .send({ message: "Email and Display Name are required." });
        }
        const existingUser = await userCollection.findOne({ email });
        if (existingUser) {
          return res
            .status(201)
            .send({ message: "User already exists with this email." });
        }
        const result = await userCollection.insertOne(newUser);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });

    console.log("Connected to MongoDB successfully!");
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("rexAuction Is Connected!");
});

app.listen(port, () => {
  console.log(`rexAuction is loading at port ${port}`);
});
