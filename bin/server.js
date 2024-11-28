#!/usr/bin/env node

import * as yredis from "@reearth/flow-websocket";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const CONFIG = {
  port: parseInt(process.env.PORT || "8080"),
  redisPrefix: process.env.REDIS_PREFIX || "y",
  postgresUrl: process.env.POSTGRES_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucketName: process.env.S3_BUCKET_NAME || "ydocs",
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME || "ydocs",
  },
};

async function initializeS3Storage() {
  console.log("Initializing S3 storage");
  const { createS3Storage } = await import("../src/storage/s3.js");
  const store = createS3Storage(CONFIG.s3.bucketName);

  try {
    await store.client.makeBucket(CONFIG.s3.bucketName);
    console.log(`Ensured S3 bucket ${CONFIG.s3.bucketName} exists`);
  } catch (error) {
    // Bucket might already exist, which is fine
    if (error instanceof Error) {
      console.log(`Note: ${error.message}`);
    } else {
      console.log(`Note: ${String(error)}`);
    }
  }

  return store;
}

async function initializeGCSStorage() {
  console.log("Initializing GCS storage");
  const { createGCSStorage } = await import("../src/storage/gcs.js");
  return createGCSStorage(CONFIG.gcs.bucketName);
}

async function initializePostgresStorage() {
  console.log("Initializing Postgres storage");
  const { createPostgresStorage } = await import("../src/storage/postgres.js");
  return createPostgresStorage();
}

async function initializeMemoryStorage() {
  console.log(
    "ATTENTION! Initializing in-memory storage (not recommended for production)"
  );
  const { createMemoryStorage } = await import("../src/storage/memory.js");
  return createMemoryStorage();
}

async function determineStorage() {
  if (CONFIG.s3.endpoint) {
    return await initializeS3Storage();
  }

  if (CONFIG.gcs.bucketName) {
    return await initializeGCSStorage();
  }

  if (CONFIG.postgresUrl) {
    return await initializePostgresStorage();
  }

  return await initializeMemoryStorage();
}

async function startServer() {
  try {
    const store = await determineStorage();

    console.log("Starting server...");
    console.log("Configuration: ", CONFIG);

    yredis.createYWebsocketServer({
      port: CONFIG.port,
      store,
      redisPrefix: CONFIG.redisPrefix,
    });

    console.log(`Server started on port ${CONFIG.port}`);
    console.log(`Redis prefix: ${CONFIG.redisPrefix}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
