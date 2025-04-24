const logActivity = require("../utils/logger");

const activityLogger = (req, res, next) => {
  let username = "Anonymous";

  if (req.headers.authorization) {
    try {
      const token = req.headers.authorization.replace("Bearer ", "");
      const decoded = require("jsonwebtoken").verify(
        token,
        process.env.SECRET_KEY
      );
      username = decoded.email || decoded.id || "UnknownUser";
    } catch (err) {
      console.warn("Invalid token in activityLogger:", err.message);
    }
  }

  logActivity(username, req.method, req.originalUrl, {
    analysisType: req.body.analysisType,
  });

  next();
};

module.exports = activityLogger;
