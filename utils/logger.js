const fs = require('fs');
const path = require('path');


const logFilePath = path.join(__dirname, '../logs/user_activity.log');


const logActivity = (username, method, endpoint, additionalData = {}) => {
  const timestamp = new Date().toISOString();


  let additionalInfo = '';
  if (additionalData.analysisType) {

    additionalInfo = ` | AnalysisType: ${String(additionalData.analysisType)}`;
  }


  const logMessage = `[${timestamp}] ${username} used ${method} ${endpoint}${additionalInfo}\n`;

  // Append the log message to the log file
  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) console.error('Failed to write log:', err);
  });
};

module.exports = logActivity;
