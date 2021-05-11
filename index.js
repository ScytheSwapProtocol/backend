const firebase = require("./firebase/index");
const port = process.env.PORT || 3000;

const httpServer = require("http").createServer();
httpServer.listen(port, () => console.log(`Listening on port ${port}`));

const io = require("socket.io")(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const ROOMS = "rooms";

io.on("connection", (socket) => {
  console.log("Websocket connection is established");
  socket.on("user_create_room", async (data) => {
    try {
      const { user_wallet, room_label } = data;

      const roomsRef = firebase.db.collection(ROOMS);
      const snapshot = await roomsRef.get();
      const isCreated =
        snapshot.docs.filter((doc) => {
          const { server } = doc.data();
          return server.address === user_wallet;
        }).length > 0;

      if (isCreated) {
        throw new Error("A user can create only one room");
      }
      const timestamp = new Date().getTime();
      const docRef = await firebase.db.collection(ROOMS).add({
        server: {
          address: user_wallet,
          accepted: false,
          connected: timestamp,
        },
        label: room_label,
      });
      socket.room_id = docRef.id;
      socket.user_id = user_wallet;
      socket.join(docRef.id);

      /**
       * Created Room Params
       * 1. Doc Id
       * 2. Timestamp
       * 3. Room label
       */
      io.to(socket.id).emit("room_connected", docRef.id, room_label, timestamp);
      io.to(socket.id).emit("owner_connected", docRef.id, user_wallet);
      console.log(
        `/INFO/user_create_room: a room is created on ${docRef.id}(${timestamp}, ${room_label}, ${user_wallet})`
      );
    } catch (error) {
      io.to(socket.id).emit("errors_connect", error.message);
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
      const timestamp = new Date().getTime();
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
      io.in(socket.room_id).emit("participant_joined", room_id, user_wallet);
      io.to(socket.id).emit("owner_connected", room_id, server.address);
      io.to(socket.id).emit("room_connected", room_id, label, timestamp);
    } catch (error) {
      io.to(socket.id).emit("errors_connect", error.message);
      console.log("/ERROR/user_join_room: ", error);
    }
  });

  socket.on("send_message", async (data) => {
    try {
      const { user_wallet, message } = data;
      const room_id = socket.room_id;
      const timestamp = new Date().getTime();
      console.log(
        `/INFO/send_message: a new message was sent from ${user_wallet} in ${room_id})`
      );

      io.in(room_id).emit(
        "message_sent",
        room_id,
        user_wallet,
        message,
        timestamp
      );
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/send_message: ", error);
    }
  });

  socket.on("change_allowance", async (data) => {
    try {
      const { user_wallet, room_id, is_approved } = data;

      const docRef = await firebase.db.collection(ROOMS).doc(room_id);
      const { server, client } = (await docRef.get()).data();

      if (user_wallet === server.address) {
        await docRef.update({
          server: {
            ...server,
            accepted: is_approved,
          },
        });
      } else if (user_wallet === client.address) {
        await docRef.update({
          client: {
            ...client,
            accepted: is_approved,
          },
        });
      }
      console.log(
        `/INFO/change_allowance: allowance of ${user_wallet}(${room_id}) is changed as <${is_approved}>`
      );
      io.in(room_id).emit(
        "allowance_changed",
        room_id,
        user_wallet,
        is_approved
      );
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/change_allowance: ", error);
    }
  });

  socket.on("user_leave_room", async (data) => {
    try {
      const { user_wallet, room_id } = data;

      socket.leave(room_id);

      /**
       * operations related to blockchain parts
       */

      console.log("leave_room:", user_wallet, room_id);

      const docRef = await firebase.db.collection(ROOMS).doc(room_id);
      if (!docRef) return;
      const { server, client } = (await docRef.get()).data();

      if (server && server.address === user_wallet) {
        // The document can be deleted or set "deleted" flag as `true` (TBD)
        io.in(room_id).emit("room_dropped", room_id);
        await firebase.db.collection(ROOMS).doc(room_id).delete();
        console.log(
          `/INFO/user_leave_room: the current room is removed on ${room_id}`
        );
      } else if (client && client.address === user_wallet) {
        await firebase.db.collection(ROOMS).doc(room_id).update({
          client: firebase.admin.firestore.FieldValue.delete(),
        });
        io.in(room_id).emit("participant_left", room_id, user_wallet);
        console.log(
          `/INFO/user_leave_room: a participant(${user_wallet}) left the room`
        );
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

      if (!docId || !userWallet) return;
      socket.leave(docId);

      /**
       * operations related to blockchain parts
       */

      const docRef = await firebase.db.collection(ROOMS).doc(docId);
      const { server, client } = (await docRef.get()).data();

      if (server && server.address === userWallet) {
        // The document can be deleted or set "deleted" flag as `true` (TBD)
        io.in(socket.room_id).emit("room_dropped", docId);
        await firebase.db.collection(ROOMS).doc(docId).delete();
        console.log(
          `/INFO/disconnect: the current room is removed on ${docId}`
        );
      } else if (client && client.address === userWallet) {
        await firebase.db.collection(ROOMS).doc(docId).update({
          client: firebase.admin.firestore.FieldValue.delete(),
        });
        io.in(socket.room_id).emit("participant_left", docId, userWallet);
        console.log(
          `/INFO/disconnect: a participant(${userWallet}) left the room`
        );
      }
    } catch (error) {
      io.to(socket.id).emit("errors", error.message);
      console.log("/ERROR/disconnect: ", error);
    }
  });
});
