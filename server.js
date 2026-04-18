const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/get-entities-overdue", async (req, res) => {
  res.json({
    success: true,
    message: "Service is alive",
    dueInXNumberOfDays: 3,
    appointmentMissed: 0,
    inspectionDue: 0,
    inspectionOverdue: 0,
    workOrderDue: 0,
    workOrderOverdue: 1001,
    plannedMaintenanceDue: 0,
    plannedMaintenanceOverdue: 0,
    servicingVisitsDue: 0,
    servicingVisitsOverdue: 0,
    asbestosDue: 0,
    asbestosOverdue: 0
  });
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
