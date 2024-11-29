#!/usr/bin/env node

import * as env from "lib0/environment";
import * as yredis from "@reearth/flow-websocket";
import * as Y from "yjs";
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const CONFIG = {
  redisPrefix: process.env.REDIS_PREFIX || "y",
  postgresUrl: process.env.POSTGRES_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucketName: process.env.S3_BUCKET_NAME
  },
  gcs: {
    bucketName: process.env.GCS_BUCKET_NAME
  },
  callback: {
    url: env.getConf("ydoc-update-callback"),
    timeoutMs: 30000 // 30 seconds timeout for callbacks
  }
};

async function initializeS3Storage() {
  console.log("Initializing S3 storage");
  const { createS3Storage } = await import("../src/storage/s3.js");
  const store = createS3Storage(CONFIG.s3.bucketName || "ydocs");
  
  try {
    await store.client.makeBucket(CONFIG.s3.bucketName || "ydocs");
    console.log(`Ensured S3 bucket ${CONFIG.s3.bucketName} exists`);
  } catch (error) {
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
  return createGCSStorage(CONFIG.gcs.bucketName || "ydocs");
}

async function initializePostgresStorage() {
  console.log("Initializing Postgres storage");
  const { createPostgresStorage } = await import("../src/storage/postgres.js");
  return createPostgresStorage();
}

async function initializeMemoryStorage() {
  console.log("ATTENTION! Initializing in-memory storage (not recommended for production)");
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

/**
 * Creates and normalizes the callback URL
 * @returns {string|null}
 */
function normalizeCallbackUrl() {
  if (!CONFIG.callback.url) return null;
  
  let url = CONFIG.callback.url;
  if (!url.endsWith("/")) {
    url += "/";
  }
  return url;
}

/**
 * Handles document updates by sending them to the callback URL
 * @param {string} room
 * @param {Y.Doc} ydoc
 * @returns {Promise<void>}
 */
async function handleDocumentUpdate(room, ydoc) {
  const callbackUrl = normalizeCallbackUrl();
  if (!callbackUrl) return;

  const formData = new FormData();
  const docUpdate = Y.encodeStateAsUpdateV2(ydoc);
  formData.append("ydoc", new Blob([docUpdate]));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.callback.timeoutMs);

  try {
    const response = await fetch(new URL(room, callbackUrl), {
      method: "PUT",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Callback timeout for room: ${room}`);
    } else {
      if (error instanceof Error) {
        console.error(`Callback error for room ${room}:`, error.message);
      } else {
        console.error(`Callback error for room ${room}:`, error);
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function startWorker() {
  try {
    const store = await determineStorage();
    
    yredis.createWorker(store, CONFIG.redisPrefix, {
      updateCallback: handleDocumentUpdate,
    });

    console.log(`Worker started with Redis prefix: ${CONFIG.redisPrefix}`);
    if (normalizeCallbackUrl()) {
      console.log(`Update callback URL configured: ${normalizeCallbackUrl()}`);
    }
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();
