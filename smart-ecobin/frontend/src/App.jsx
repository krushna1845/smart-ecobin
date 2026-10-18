import { useEffect, useState, useRef } from "react";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline
} from "react-leaflet";

import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "./App.css";

// ============================================================
// LEAFLET MARKER FIX
// ============================================================

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",

  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",

  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

// ============================================================
// FIXED CITY LOCATIONS
// ============================================================

const OFFICE = [19.0760, 72.8777];

const WET_BIN = [19.0785, 72.8810];

const DRY_BIN = [19.0735, 72.8840];

// Initial van position.
// The server becomes the real source of truth after startup.

const VAN_START = [19.0760, 72.8777];

// ============================================================
// OFFICE ICON
// ============================================================

const officeIcon = L.divIcon({

  className: "custom-marker",

  html: `
    <div class="office-marker">
      🏢
    </div>
  `,

  iconSize: [45, 45],

  iconAnchor: [22, 22]

});

// ============================================================
// VAN ICON
// ============================================================

const vanIcon = L.divIcon({

  className: "custom-marker",

  html: `
    <div class="van-wrapper">

      <div class="van-label">
        🚛 ECO-01
      </div>

      <div class="van-body">

        <div class="van-cabin">
          🚛
        </div>

      </div>

      <div class="van-shadow"></div>

    </div>
  `,

  iconSize: [110, 75],

  iconAnchor: [55, 45]

});

// ============================================================
// BIN ICON
// ============================================================

function createBinIcon(fill, type) {

  let color = "#22a06b";

  if (fill >= 80) {

    color = "#e53935";

  } else if (fill >= 60) {

    color = "#f59e0b";

  }

  return L.divIcon({

    className: "custom-marker",

    html: `
      <div
        class="bin-marker"
        style="background:${color}"
      >
        🗑️
      </div>

      <div class="bin-label">
        ${type}<br>
        <strong>${fill.toFixed(0)}%</strong>
      </div>
    `,

    iconSize: [60, 70],

    iconAnchor: [30, 35]

  });

}

// ============================================================
// MAIN APP
// ============================================================

function App() {

  // ==========================================================
  // DATA FROM NODE.JS
  // ==========================================================

  const [data, setData] = useState({

    bin1: {
      id: "BIN-01",
      name: "Wet Waste",
      distance: 0,
      fill: 0,
      status: "Waiting"
    },

    bin2: {
      id: "BIN-02",
      name: "Dry Waste",
      distance: 0,
      fill: 0,
      status: "Waiting"
    },

    job: null,

    van: {
      id: "ECO-01",
      latitude: VAN_START[0],
      longitude: VAN_START[1],
      status: "AVAILABLE"
    }

  });

  // ==========================================================
  // UI MESSAGE
  // ==========================================================

  const [actionMessage, setActionMessage] =
    useState("");

  // ==========================================================
  // ROUTE
  // ==========================================================

  const [routeCoordinates, setRouteCoordinates] =
    useState([]);

  const [routeInfo, setRouteInfo] =
    useState(null);

  // ==========================================================
  // VAN POSITION
  // ==========================================================

  const [vanPosition, setVanPosition] =
    useState(VAN_START);

  const [vanMoving, setVanMoving] =
    useState(false);

  // Used to cancel animation.

  const animationRef =
    useRef(null);

  // Prevent polling from overwriting
  // the animated van position.

  const vanMovingRef =
    useRef(false);

  // ==========================================================
  // GET DATA FROM NODE.JS
  // ==========================================================

  useEffect(() => {

    const getData = async () => {

      try {

        const response =
          await fetch("/api/data");

        const result =
          await response.json();

        setData(result);

        // IMPORTANT:
        // Only update the map position from the server
        // when the van is NOT currently animating.

        if (
          !vanMovingRef.current &&
          result.van
        ) {

          setVanPosition([
            result.van.latitude,
            result.van.longitude
          ]);

        }

      } catch (error) {

        console.error(
          "Cannot connect to Node.js:",
          error
        );

      }

    };

    getData();

    const interval =
      setInterval(
        getData,
        2000
      );

    return () => {

      clearInterval(interval);

    };

  }, []);

  // ==========================================================
  // ALERT CHECK
  // ==========================================================

  const wetAlert =
    data.bin1.fill >= 80;

  const dryAlert =
    data.bin2.fill >= 80;

  // ==========================================================
  // STOP / CLEAR ROUTE WHEN COLLECTION COMPLETES
  // ==========================================================

  useEffect(() => {

    if (
      data.job?.status === "COMPLETED"
    ) {

      // Stop any animation.

      if (
        animationRef.current
      ) {

        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;

      }

      setVanMoving(false);

      vanMovingRef.current = false;

      // Remove old road route.

      setRouteCoordinates([]);

      // Remove route information.

      setRouteInfo(null);

      setActionMessage(
        "✅ Collection completed. ECO-01 is now at the collected bin."
      );

    }

  }, [
    data.job?.status
  ]);

  // ==========================================================
  // LOAD OSRM ROAD ROUTE
  // ==========================================================
  //
  // When collection starts:
  //
  // Server calculates:
  //
  // CURRENT VAN LOCATION → TARGET BIN
  //
  // Not:
  //
  // OFFICE → TARGET BIN
  //

  useEffect(() => {

    if (
      data.job?.status !== "COLLECTING" ||
      !data.job?.binId
    ) {

      return;

    }

    let cancelled = false;

    const loadRoute = async () => {

      try {

        console.log(
          "Requesting OSRM route for:",
          data.job.binId
        );

        const response =
          await fetch(
            `/api/route?bin=${data.job.binId}`
          );

        const result =
          await response.json();

        if (!response.ok) {

          throw new Error(
            result.error ||
            "Route request failed"
          );

        }

        if (
          !result.geometry ||
          !result.geometry.coordinates ||
          result.geometry.coordinates.length < 2
        ) {

          throw new Error(
            "OSRM returned an invalid route"
          );

        }

        if (cancelled) {
          return;
        }

        // ====================================================
        // OSRM:
        //
        // [longitude, latitude]
        //
        // Leaflet:
        //
        // [latitude, longitude]
        // ====================================================

        const points =
          result.geometry.coordinates.map(
            ([longitude, latitude]) => {

              return [
                latitude,
                longitude
              ];

            }
          );

        // Save route.

        setRouteCoordinates(points);

        // Save route information.

        setRouteInfo({

          distance:
            result.distance,

          duration:
            result.duration

        });

        // IMPORTANT:
        // Start exactly where OSRM says
        // the route starts.

        setVanPosition(points[0]);

        setVanMoving(true);

        vanMovingRef.current = true;

        setActionMessage(
          `🚛 ECO-01 is travelling to ${data.job.binId}.`
        );

        console.log(
          "OSRM route loaded:",
          result.distance,
          "meters"
        );

      } catch (error) {

        if (cancelled) {
          return;
        }

        console.error(
          "Could not load OSRM route:",
          error
        );

        setActionMessage(
          "⚠️ Could not calculate road route."
        );

      }

    };

    loadRoute();

    return () => {

      cancelled = true;

    };

  }, [
    data.job?.status,
    data.job?.binId
  ]);

  // ==========================================================
  // ANIMATE VAN ALONG ROAD
  // ==========================================================

  useEffect(() => {

    if (
      !vanMoving ||
      routeCoordinates.length < 2
    ) {

      return;

    }

    // ========================================================
    // DEMO ANIMATION TIME
    // ========================================================
    //
    // Real OSRM ETA may be longer.
    //
    // For project demonstration:
    // 30 seconds.
    //

    const animationDuration =
      30000;

    const startTime =
      performance.now();

    const animate = (currentTime) => {

      const elapsed =
        currentTime -
        startTime;

      const progress =
        Math.min(
          elapsed /
          animationDuration,
          1
        );

      // ======================================================
      // FIND POSITION ALONG ROUTE
      // ======================================================

      const exactIndex =
        progress *
        (routeCoordinates.length - 1);

      const index =
        Math.floor(
          exactIndex
        );

      const fraction =
        exactIndex -
        index;

      const current =
        routeCoordinates[
          Math.min(
            index,
            routeCoordinates.length - 1
          )
        ];

      const next =
        routeCoordinates[
          Math.min(
            index + 1,
            routeCoordinates.length - 1
          )
        ];

      // ======================================================
      // INTERPOLATE POSITION
      // ======================================================

      const latitude =
        current[0] +
        (next[0] - current[0]) *
        fraction;

      const longitude =
        current[1] +
        (next[1] - current[1]) *
        fraction;

      // ======================================================
      // MOVE VAN
      // ======================================================

      setVanPosition([
        latitude,
        longitude
      ]);

      // ======================================================
      // CONTINUE
      // ======================================================

      if (progress < 1) {

        animationRef.current =
          requestAnimationFrame(
            animate
          );

      } else {

        // ====================================================
        // VAN REACHED DESTINATION
        // ====================================================

        const finalPosition =
          routeCoordinates[
            routeCoordinates.length - 1
          ];

        setVanPosition(
          finalPosition
        );

        setVanMoving(false);

        vanMovingRef.current = false;

        // ====================================================
        // SAVE FINAL VAN LOCATION
        // ====================================================

        fetch("/api/van/location", {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({

            latitude:
              finalPosition[0],

            longitude:
              finalPosition[1]

          })

        })
          .then(response =>
            response.json()
          )
          .then(result => {

            console.log(
              "🚛 Van location updated:",
              result
            );

          })
          .catch(error => {

            console.error(
              "Could not update van location:",
              error
            );

          });

        setActionMessage(
          "📍 ECO-01 reached the collection bin."
        );

      }

    };

    animationRef.current =
      requestAnimationFrame(
        animate
      );

    // ========================================================
    // CLEANUP
    // ========================================================

    return () => {

      if (
        animationRef.current
      ) {

        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;

      }

    };

  }, [
    routeCoordinates,
    vanMoving
  ]);

  // ==========================================================
  // ASSIGN VAN
  // ==========================================================

  const assignVan = async () => {

    try {

      const response =
        await fetch(
          "/api/job/assign",
          {
            method: "POST"
          }
        );

      const result =
        await response.json();

      if (!response.ok) {

        throw new Error(
          result.message ||
          "Could not assign van"
        );

      }

      if (result.success) {

        setData(
          previous => ({

            ...previous,

            job:
              result.job,

            van:
              result.van

          })
        );

        // Do not move the van.

        setActionMessage(
          "🚛 ECO-01 assigned successfully."
        );

      }

    } catch (error) {

      console.error(
        "Could not assign van:",
        error
      );

      setActionMessage(
        "⚠️ Could not assign ECO-01."
      );

    }

  };

  // ==========================================================
  // START COLLECTION
  // ==========================================================

  const startCollection = async () => {

    try {

      // Clear any previous route.

      setRouteCoordinates([]);

      setRouteInfo(null);

      // Stop old animation if any.

      if (
        animationRef.current
      ) {

        cancelAnimationFrame(
          animationRef.current
        );

        animationRef.current = null;

      }

      setVanMoving(false);

      vanMovingRef.current = false;

      const response =
        await fetch(
          "/api/job/start",
          {
            method: "POST"
          }
        );

      const result =
        await response.json();

      if (!response.ok) {

        throw new Error(
          result.message ||
          "Could not start collection"
        );

      }

      if (result.success) {

        setData(
          previous => ({

            ...previous,

            job:
              result.job,

            van:
              result.van

          })
        );

        // ====================================================
        // IMPORTANT
        // ====================================================
        //
        // DO NOT DO:
        //
        // setVanPosition(VAN_START)
        //
        // The server already knows where the van is.
        //
        // If it collected BIN-01 before this,
        // the server location is BIN-01.
        //

        if (result.van) {

          setVanPosition([
            result.van.latitude,
            result.van.longitude
          ]);

        }

        setActionMessage(
          "🚛 ECO-01 is now travelling to the full bin."
        );

      }

    } catch (error) {

      console.error(
        "Could not start collection:",
        error
      );

      setActionMessage(
        "⚠️ Could not start collection."
      );

    }

  };

  // ==========================================================
  // RETURN DASHBOARD
  // ==========================================================

  return (

    <div className="dashboard">

      {/* =====================================================
          HEADER
      ====================================================== */}

      <header className="topbar">

        <div>

          <h1>
            Smart EcoBin
          </h1>

          <p>
            Smart City Waste Management
          </p>

        </div>

        <div className="connection">

          <span className="online-dot"></span>

          Arduino Connected

        </div>

      </header>

      {/* =====================================================
          COLLECTION ALERT
      ====================================================== */}

      {(wetAlert || dryAlert) && (

        <div className="alert-box">

          <div className="alert-symbol">
            ⚠️
          </div>

          <div>

            <strong>
              Waste Collection Alert
            </strong>

            <p>

              {wetAlert &&
                "Wet Waste Bin has reached 80%. "}

              {dryAlert &&
                "Dry Waste Bin has reached 80%."}

            </p>

            <small>
              Collector vehicle required.
            </small>

          </div>

        </div>

      )}

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}

      <div className="content">

        {/* ===================================================
            MAP
        ==================================================== */}

        <div className="map-card">

          {/* =================================================
              LIVE VAN MESSAGE
          ================================================== */}

          {data.job?.status === "COLLECTING" && (

            <div className="map-message">

              🚛 ECO-01 is on the way to{" "}

              <strong>
                {data.job.binId}
              </strong>

              {routeInfo && (

                <span>

                  {" "}•{" "}

                  {(routeInfo.distance / 1000)
                    .toFixed(2)}

                  {" "}km

                  {" "}•{" "}

                  {Math.round(
                    routeInfo.duration
                  )}

                  {" "}sec ETA

                </span>

              )}

            </div>

          )}

          <MapContainer

            center={[
              19.0760,
              72.8810
            ]}

            zoom={15}

            scrollWheelZoom={true}

            className="map"

          >

            {/* =================================================
                OPEN STREET MAP
            ================================================== */}

            <TileLayer

              attribution=
                '&copy; OpenStreetMap contributors'

              url=
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

            />

            {/* =================================================
                OFFICE
            ================================================== */}

            <Marker

              position={OFFICE}

              icon={officeIcon}

            >

              <Popup>

                <strong>
                  Waste Collection Office
                </strong>

                <br />

                Central Collection Center

              </Popup>

            </Marker>

            {/* =================================================
                MOVING COLLECTOR VAN
            ================================================== */}

            <Marker

              position={vanPosition}

              icon={vanIcon}

            >

              <Popup>

                <strong>
                  🚛 ECO-01
                </strong>

                <br />

                {vanMoving

                  ? "En route to collect waste"

                  : data.job?.status === "COMPLETED"

                  ? "Collection completed"

                  : data.job?.status === "COLLECTING"

                  ? "At collection point"

                  : "Collector vehicle"

                }

              </Popup>

            </Marker>

            {/* =================================================
                WET WASTE BIN
            ================================================== */}

            <Marker

              position={WET_BIN}

              icon={
                createBinIcon(
                  data.bin1.fill,
                  "Wet Waste"
                )
              }

            >

              <Popup>

                <strong>
                  Wet Waste Bin
                </strong>

                <br />

                Bin ID:
                {" "}
                {data.bin1.id}

                <br />

                Fill:
                {" "}
                {data.bin1.fill.toFixed(1)}%

                <br />

                Distance:
                {" "}
                {data.bin1.distance.toFixed(1)}
                {" "}
                cm

                <br />

                Status:
                {" "}
                {data.bin1.fill >= 80
                  ? "FULL ALERT"
                  : "NORMAL"
                }

              </Popup>

            </Marker>

            {/* =================================================
                DRY WASTE BIN
            ================================================== */}

            <Marker

              position={DRY_BIN}

              icon={
                createBinIcon(
                  data.bin2.fill,
                  "Dry Waste"
                )
              }

            >

              <Popup>

                <strong>
                  Dry Waste Bin
                </strong>

                <br />

                Bin ID:
                {" "}
                {data.bin2.id}

                <br />

                Fill:
                {" "}
                {data.bin2.fill.toFixed(1)}%

                <br />

                Distance:
                {" "}
                {data.bin2.distance.toFixed(1)}
                {" "}
                cm

                <br />

                Status:
                {" "}
                {data.bin2.fill >= 80
                  ? "FULL ALERT"
                  : "NORMAL"
                }

              </Popup>

            </Marker>

            {/* =================================================
                REAL OSRM ROAD ROUTE
            ================================================== */}

            {routeCoordinates.length > 0 && (

              <Polyline

                positions={
                  routeCoordinates
                }

                pathOptions={{

                  color: "#e53935",

                  weight: 6,

                  opacity: 0.85

                }}

              />

            )}

          </MapContainer>

        </div>

        {/* ===================================================
            RIGHT PANEL
        ==================================================== */}

        <aside className="side-panel">

          {/* =================================================
              CITY STATUS
          ================================================== */}

          <div className="panel-card">

            <h2>
              City Status
            </h2>

            <div className="city-status">

              <span className="green-dot"></span>

              Monitoring Active

            </div>

          </div>

          {/* =================================================
              WET WASTE
          ================================================== */}

          <div
            className={
              data.bin1.fill >= 80
                ? "bin-card danger"
                : "bin-card"
            }
          >

            <div className="bin-card-header">

              <h3>
                🗑️ Wet Waste
              </h3>

              <span>
                Bin 01
              </span>

            </div>

            <div className="percentage">

              {data.bin1.fill.toFixed(1)}%

            </div>

            <div className="progress">

              <div

                style={{

                  width:
                    `${Math.min(
                      data.bin1.fill,
                      100
                    )}%`

                }}

              />

            </div>

            <p>

              Sensor distance:
              {" "}

              {data.bin1.distance.toFixed(1)}

              {" "}
              cm

            </p>

            <strong>

              {data.bin1.fill >= 80

                ? "⚠ COLLECTION REQUIRED"

                : "✓ NORMAL"

              }

            </strong>

          </div>

          {/* =================================================
              DRY WASTE
          ================================================== */}

          <div
            className={
              data.bin2.fill >= 80
                ? "bin-card danger"
                : "bin-card"
            }
          >

            <div className="bin-card-header">

              <h3>
                🗑️ Dry Waste
              </h3>

              <span>
                Bin 02
              </span>

            </div>

            <div className="percentage">

              {data.bin2.fill.toFixed(1)}%

            </div>

            <div className="progress">

              <div

                style={{

                  width:
                    `${Math.min(
                      data.bin2.fill,
                      100
                    )}%`

                }}

              />

            </div>

            <p>

              Sensor distance:
              {" "}

              {data.bin2.distance.toFixed(1)}

              {" "}
              cm

            </p>

            <strong>

              {data.bin2.fill >= 80

                ? "⚠ COLLECTION REQUIRED"

                : "✓ NORMAL"

              }

            </strong>

          </div>

          {/* =================================================
              COLLECTION JOB
          ================================================== */}

          <div className="panel-card">

            <h2>
              📋 Collection Job
            </h2>

            {!data.job && (

              <p>
                No collection job currently active.
              </p>

            )}

            {data.job && (

              <>

                <p>

                  <strong>
                    Job ID:
                  </strong>

                  {" "}

                  {data.job.jobId}

                </p>

                <p>

                  <strong>
                    Bin:
                  </strong>

                  {" "}

                  {data.job.binId}

                </p>

                <p>

                  <strong>
                    Waste:
                  </strong>

                  {" "}

                  {data.job.wasteType}

                </p>

                <p>

                  <strong>
                    Fill:
                  </strong>

                  {" "}

                  {Number(
                    data.job.fill
                  ).toFixed(1)}%

                </p>

                <p>

                  <strong>
                    Priority:
                  </strong>

                  {" "}

                  {data.job.priority}

                </p>

                <p>

                  <strong>
                    Status:
                  </strong>

                  {" "}

                  {data.job.status}

                </p>

                {/* =================================================
                    ROUTE INFORMATION
                ================================================== */}

                {routeInfo && (

                  <div className="route-info">

                    <p>

                      <strong>
                        Road distance:
                      </strong>

                      {" "}

                      {(routeInfo.distance / 1000)
                        .toFixed(2)}

                      {" "}
                      km

                    </p>

                    <p>

                      <strong>
                        Driving ETA:
                      </strong>

                      {" "}

                      {Math.round(
                        routeInfo.duration
                      )}

                      {" "}
                      seconds

                    </p>

                  </div>

                )}

                {/* =================================================
                    ASSIGN
                ================================================== */}

                {data.job.status === "PENDING" && (

                  <button

                    className="action-button"

                    onClick={assignVan}

                  >

                    🚛 ASSIGN ECO-01

                  </button>

                )}

                {/* =================================================
                    START
                ================================================== */}

                {data.job.status === "ASSIGNED" && (

                  <button

                    className="action-button"

                    onClick={startCollection}

                  >

                    ▶ START COLLECTION

                  </button>

                )}

                {/* =================================================
                    COLLECTING
                ================================================== */}

                {data.job.status === "COLLECTING" && (

                  <div className="collecting-message">

                    🚛 ECO-01 is travelling
                    to the bin...

                  </div>

                )}

                {/* =================================================
                    COMPLETED
                ================================================== */}

                {data.job.status === "COMPLETED" && (

                  <div className="completed-message">

                    ✅ Collection completed

                  </div>

                )}

              </>

            )}

            {/* =================================================
                ACTION MESSAGE
            ================================================== */}

            {actionMessage && (

              <p className="action-message">

                {actionMessage}

              </p>

            )}

          </div>

          {/* =================================================
              COLLECTOR
          ================================================== */}

          <div className="panel-card">

            <h2>
              🚛 Collector
            </h2>

            <p>

              Vehicle:
              {" "}
              ECO-01

            </p>

            <p>

              Location:

              {" "}

              {vanMoving

                ? "En route to bin"

                : data.job?.status === "COMPLETED"

                ? "Collection point"

                : data.job?.status === "COLLECTING"

                ? "At collection point"

                : "Current location"

              }

            </p>

            <p>

              Status:

              {" "}

              {data.job?.status === "COLLECTING"

                ? "🚛 COLLECTING"

                : data.job?.status === "ASSIGNED"

                ? "ASSIGNED"

                : wetAlert || dryAlert

                ? "⚠ DISPATCH REQUIRED"

                : "AVAILABLE"

              }

            </p>

            <p>

              <strong>
                Current coordinates:
              </strong>

              <br />

              {vanPosition[0].toFixed(5)},
              {" "}
              {vanPosition[1].toFixed(5)}

            </p>

          </div>

        </aside>

      </div>

    </div>

  );

}

export default App;