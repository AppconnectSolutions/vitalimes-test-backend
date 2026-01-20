import bcrypt from "bcryptjs";

const password = "Vitalime@12345";

bcrypt.hash(password, 10).then((hash) => {
  console.log("Hashed Password:", hash);
});