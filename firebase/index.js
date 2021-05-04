const admin = require("firebase-admin");
const serviceAccount = require("./ServiceAccountKey.json");

function getDb() {
  if (admin.apps.length == 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin.firestore();
}

function getAdmin() {
  if (admin.apps.length == 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin;
}

const db = getDb();
const firebase = getAdmin();

module.exports = {
  db,
  firebase,
};
