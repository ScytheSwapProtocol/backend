const firebase = require("./firebase/index");
const httpServer = require("http").createServer();
const port = process.env.PORT || 3000;

httpServer.listen(port);

const io = require("socket.io")(httpServer);
const ROOMS = "rooms";

io.use((socket, next) => {
  // (TBD) JWT-Authentication
});

io.of("/").on("connection", (socket) => {
  socket.on("user_create_room", async (data) => {
    try {
      const { user_wallet, room_label } = data;

      const roomsRef = firebase.db.collection(ROOMS);
      const snapshot = await roomsRef.get();
      for (let i = 0; i < snapshot.length; i++) {
        const { server } = snapshot[i].data();
        if (server === user_wallet) {
          throw new Error("A user can create only one room");
        }
      }
      const timestamp = Math.round(new Date().getTime() / 1000);
      const docId = await firebase.db.collection(ROOMS).add({
        server: {
          address: user_wallet,
          accepted: false,
          connected: timestamp,
        },
        label: room_label,
      });
      socket.room_id = docId;
      socket.join_id = user_wallet;
      socket.join(docId);

      /**
       * Created Room Params
       * 1. Doc Id
       * 2. Timestamp
       * 3. Room label
       */
      io.to(socket.id).emit("room_created", docId, timestamp, room_label);
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/user_create_room: ", error);
    }
  });

  socket.on("user_join_room", async (data) => {
    try {
      const { user_wallet, room_id } = data;

      const docRef = await firebase.db.collection(ROOMS).doc(room_id);
      const { server, client, label } = (await docRef.get()).data();
      if (server.address === user_wallet) {
        throw new Error("The user is already registerd as the room owner");
      }
      if (client) {
        throw new Error("The room is already filled");
      }
      socket.room_id = room_id;
      socket.user_id = user_wallet;
      socket.join(room_id);
      const timestamp = Math.round(new Date().getTime() / 1000);
      await docRef.update({
        client: {
          address: user_wallet,
          accepted: false,
          connected: timestamp,
        },
      });

      /**
       * Joined Other Party Params
       * 1. Doc Id
       * 2. Label
       * 3. Other party wallet(address)
       */
      socket.broadcast
        .to(socket.room_id)
        .emit("other_party_joined", room_id, label, user_wallet);
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/user_join_room: ", error);
    }
  });

  socket.on("user_leave_room", async (data) => {
    try {
      const { user_wallet, room_id } = data;

      socket.leave(room_id);

      /**
       * User left Params
       * 1. Doc Id
       * 2. User wallet
       */
      socket.broadcast.to(room_id).emit("user_left_room", room_id, user_wallet);

      /**
       * operations related to blockchain parts
       */

      const docRef = await firebase.db.collection(ROOMS).doc(room_id);
      const { server, client } = (await docRef.get()).data();

      if (server.address === user_wallet) {
        // The document can be deleted or set "deleted" flag as `true` (TBD)
        await firebase.db.collection(ROOMS).doc(room_id).delete();
      } else if (client.address === user_wallet) {
        await firebase.db.collection(ROOMS).doc(room_id).update({
          client: undefined,
        });
      }
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/user_leave_room: ", error);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const docId = socket.room_id;
      const userWallet = socket.user_id;
      socket.leave(docId);

      /**
       * User left Params
       * 1. Doc Id
       * 2. User wallet
       */
      socket.broadcast
        .to(socket.room_id)
        .emit("user_left_room", docId, userWallet);

      /**
       * operations related to blockchain parts
       */

      const docRef = await firebase.db.collection(ROOMS).doc(docId);
      const { server, client } = (await docRef.get()).data();

      if (server.address === userWallet) {
        // The document can be deleted or set "deleted" flag as `true` (TBD)
        await firebase.db.collection(ROOMS).doc(docId).delete();
      } else if (client.address === userWallet) {
        await firebase.db.collection(ROOMS).doc(docId).update({
          client: undefined,
        });
      }
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/disconnect: ", error);
    }
  });
});
