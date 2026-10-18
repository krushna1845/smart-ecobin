const express = require("express");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const app = express();

const PORT = 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());

// ============================================================
// LOCATIONS
// ============================================================

const LOCATIONS = {
    office: [19.0760, 72.8777],

    wetBin: [19.0785, 72.8810],

    dryBin: [19.0735, 72.8840]
};

// ============================================================
// ECO-01 CURRENT LOCATION
// ============================================================
//
// IMPORTANT:
// The van does NOT return to the office automatically.
//
// If ECO-01 collects BIN-01,
// its new location becomes BIN-01.
//
// Then if BIN-02 needs collection,
// the next route starts from BIN-01.
//

let van = {
    id: "ECO-01",

    latitude: LOCATIONS.office[0],

    longitude: LOCATIONS.office[1],

    status: "AVAILABLE"
};

// ============================================================
// ARDUINO SERIAL CONNECTION
// ============================================================

const arduinoPort = new SerialPort({
    path: "COM8",
    baudRate: 9600
});

const parser = arduinoPort.pipe(
    new ReadlineParser({
        delimiter: "\r\n"
    })
);

// ============================================================
// BIN DATA
// ============================================================

let bin1 = {
    id: "BIN-01",
    name: "Wet Waste",
    distance: 0,
    fill: 0,
    status: "Waiting"
};

let bin2 = {
    id: "BIN-02",
    name: "Dry Waste",
    distance: 0,
    fill: 0,
    status: "Waiting"
};

// ============================================================
// COLLECTION JOB
// ============================================================

let currentJob = null;

let jobCounter = 1;

// ============================================================
// CREATE COLLECTION JOB
// ============================================================

function createJob(bin) {

    // If there is already an active job,
    // do not replace it.
    //
    // This keeps the system simple:
    // one van = one active collection job.

    if (
        currentJob &&
        currentJob.status !== "COMPLETED"
    ) {
        return;
    }

    currentJob = {
        jobId: `JOB-${String(jobCounter).padStart(3, "0")}`,

        binId: bin.id,

        wasteType: bin.name,

        fill: bin.fill,

        priority: "HIGH",

        status: "PENDING",

        createdAt: new Date().toLocaleString()
    };

    jobCounter++;

    console.log("");
    console.log("=================================");
    console.log("🚨 COLLECTION JOB CREATED");
    console.log("=================================");
    console.log(`Job ID:     ${currentJob.jobId}`);
    console.log(`Bin ID:     ${currentJob.binId}`);
    console.log(`Waste Type: ${currentJob.wasteType}`);
    console.log(`Fill:       ${currentJob.fill.toFixed(2)}%`);
    console.log(`Priority:   ${currentJob.priority}`);
    console.log(`Status:     ${currentJob.status}`);
    console.log("=================================");
    console.log("");
}

// ============================================================
// ARDUINO DATA
// ============================================================

parser.on("data", (data) => {

    console.log("Arduino:", data);

    const parts = data.split(",");

    // ========================================================
    // BIN 1
    // ========================================================

    if (parts[0] === "BIN1") {

        if (parts[1] === "ERROR") {

            bin1.status = "Sensor Error";

        } else {

            bin1.distance = parseFloat(parts[1]);

            bin1.fill = parseFloat(parts[2]);

            if (bin1.fill >= 80) {

                bin1.status = "FULL ALERT";

                createJob(bin1);

            } else {

                bin1.status = "NORMAL";

                // Only complete a job if the van
                // was actually collecting this bin.
                if (
                    currentJob &&
                    currentJob.binId === bin1.id &&
                    currentJob.status === "COLLECTING"
                ) {

                    currentJob.status = "COMPLETED";

                    van.status = "AVAILABLE";

                    console.log("");
                    console.log("✅ COLLECTION COMPLETED");
                    console.log(`Bin: ${bin1.id}`);
                    console.log(
                        `Fill level: ${bin1.fill.toFixed(2)}%`
                    );
                    console.log(
                        `Van location: ${van.latitude}, ${van.longitude}`
                    );
                    console.log("");
                }
            }
        }
    }

    // ========================================================
    // BIN 2
    // ========================================================

    if (parts[0] === "BIN2") {

        if (parts[1] === "ERROR") {

            bin2.status = "Sensor Error";

        } else {

            bin2.distance = parseFloat(parts[1]);

            bin2.fill = parseFloat(parts[2]);

            if (bin2.fill >= 80) {

                bin2.status = "FULL ALERT";

                createJob(bin2);

            } else {

                bin2.status = "NORMAL";

                // Only complete a job if the van
                // was actually collecting this bin.
                if (
                    currentJob &&
                    currentJob.binId === bin2.id &&
                    currentJob.status === "COLLECTING"
                ) {

                    currentJob.status = "COMPLETED";

                    van.status = "AVAILABLE";

                    console.log("");
                    console.log("✅ COLLECTION COMPLETED");
                    console.log(`Bin: ${bin2.id}`);
                    console.log(
                        `Fill level: ${bin2.fill.toFixed(2)}%`
                    );
                    console.log(
                        `Van location: ${van.latitude}, ${van.longitude}`
                    );
                    console.log("");
                }
            }
        }
    }
});

// ============================================================
// FRONTEND
// ============================================================

app.use(express.static("public"));

// ============================================================
// API - ALL DASHBOARD DATA
// ============================================================

app.get("/api/data", (req, res) => {

    res.json({
        bin1,
        bin2,
        job: currentJob,
        van
    });

});

// ============================================================
// OSRM ROUTE
// ============================================================
//
// Route starts from the VAN'S CURRENT LOCATION.
//
// Example:
//
// Office
//   ↓
// BIN-01
//   ↓
// BIN-02
//
// The second route starts from BIN-01,
// NOT from the office.
//

app.get("/api/route", async (req, res) => {

    try {

        if (!req.query.bin) {

            return res.status(400).json({
                error: "Bin ID is required"
            });

        }

        // ====================================================
        // DESTINATION
        // ====================================================

        let destination;

        if (req.query.bin === "BIN-01") {

            destination = LOCATIONS.wetBin;

        } else if (req.query.bin === "BIN-02") {

            destination = LOCATIONS.dryBin;

        } else {

            return res.status(400).json({
                error: "Unknown bin"
            });

        }

        // ====================================================
        // CURRENT VAN LOCATION
        // ====================================================

        const start =
            `${van.longitude},${van.latitude}`;

        const end =
            `${destination[1]},${destination[0]}`;

        const coordinates =
            `${start};${end}`;

        const url =
            `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

        console.log("");
        console.log("=================================");
        console.log("🚛 ROUTE REQUEST");
        console.log("=================================");
        console.log(
            `Van position: ${van.latitude}, ${van.longitude}`
        );
        console.log(
            `Destination: ${req.query.bin}`
        );
        console.log("=================================");
        console.log("");

        // ====================================================
        // OSRM REQUEST
        // ====================================================

        const response = await fetch(url);

        if (!response.ok) {

            throw new Error(
                `OSRM request failed: ${response.status}`
            );

        }

        const routeData =
            await response.json();

        if (
            routeData.code !== "Ok" ||
            !routeData.routes ||
            routeData.routes.length === 0
        ) {

            return res.status(500).json({
                error: "No route found"
            });

        }

        const route =
            routeData.routes[0];

        // ====================================================
        // RETURN ROUTE
        // ====================================================

        res.json({

            distance:
                route.distance,

            duration:
                route.duration,

            geometry:
                route.geometry,

            start: {

                latitude:
                    van.latitude,

                longitude:
                    van.longitude

            },

            destination: {

                latitude:
                    destination[0],

                longitude:
                    destination[1]

            }

        });

    } catch (error) {

        console.error(
            "OSRM ERROR:",
            error.message
        );

        res.status(500).json({
            error: "Could not calculate route"
        });

    }

});

// ============================================================
// API - ASSIGN COLLECTION JOB
// ============================================================

app.post("/api/job/assign", (req, res) => {

    if (!currentJob) {

        return res.status(404).json({
            message: "No collection job available."
        });

    }

    if (currentJob.status !== "PENDING") {

        return res.status(400).json({
            message: "Job cannot be assigned."
        });

    }

    currentJob.status = "ASSIGNED";

    van.status = "ASSIGNED";

    console.log("");
    console.log("🚛 COLLECTION JOB ASSIGNED");
    console.log(`Job: ${currentJob.jobId}`);
    console.log(`Bin: ${currentJob.binId}`);
    console.log(
        `Current van location: ${van.latitude}, ${van.longitude}`
    );
    console.log("");

    res.json({

        success: true,

        job: currentJob,

        van

    });

});

// ============================================================
// API - START COLLECTION
// ============================================================

app.post("/api/job/start", (req, res) => {

    if (!currentJob) {

        return res.status(404).json({
            message: "No collection job available."
        });

    }

    if (currentJob.status !== "ASSIGNED") {

        return res.status(400).json({
            message: "Job must be assigned before starting."
        });

    }

    currentJob.status = "COLLECTING";

    van.status = "COLLECTING";

    console.log("");
    console.log("🚛 VAN STARTED COLLECTION");
    console.log(`Job: ${currentJob.jobId}`);
    console.log(`Bin: ${currentJob.binId}`);
    console.log(
        `Starting location: ${van.latitude}, ${van.longitude}`
    );
    console.log("");

    res.json({

        success: true,

        job: currentJob,

        van

    });

});

// ============================================================
// API - UPDATE VAN LOCATION
// ============================================================
//
// React calls this when the van reaches the destination.
//

app.post("/api/van/location", (req, res) => {

    const {
        latitude,
        longitude
    } = req.body;

    if (
        typeof latitude !== "number" ||
        typeof longitude !== "number"
    ) {

        return res.status(400).json({

            error:
                "Invalid vehicle location"

        });

    }

    van.latitude = latitude;

    van.longitude = longitude;

    console.log(
        `🚛 ECO-01 location updated: ${latitude}, ${longitude}`
    );

    res.json({

        success: true,

        van

    });

});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

    console.log("");
    console.log("=================================");
    console.log("       SMART ECOBIN SERVER");
    console.log("=================================");
    console.log(
        `Dashboard: http://localhost:${PORT}`
    );
    console.log("Arduino connected on COM8");
    console.log("=================================");
    console.log("");

});