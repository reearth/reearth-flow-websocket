#!/usr/bin/env node

import * as env from "lib0/environment";
import * as yredis from "@reearth/flow-websocket";
import * as Y from "yjs";

import * as dotenv from 'dotenv';
dotenv.config();

const redisPrefix = process.env.REDIS_PREFIX || "y";
const postgresUrl = process.env.POSTGRES_URL;
const s3Endpoint = process.env.S3_ENDPOINT;

let store;
if (s3Endpoint) {
  console.log("using s3 store");
  const { createS3Storage } = await import("../src/storage/s3.js");
  const bucketName = "ydocs";
  store = createS3Storage(bucketName);
  try {
    // make sure the bucket exists
    await store.client.makeBucket(bucketName);
  } catch (e) {}
} else if (env.getConf("gcp-project-id")) {
  console.log("using gcs store");
  const { createGCSStorage } = await import("../src/storage/gcs.js");
  const bucketName = "ydocs";
  store = createGCSStorage(bucketName);
} else if (postgresUrl) {
  console.log("using postgres store");
  const { createPostgresStorage } = await import("../src/storage/postgres.js");
  store = await createPostgresStorage();
} else {
  console.log("ATTENTION! using in-memory store");
  const { createMemoryStorage } = await import("../src/storage/memory.js");
  store = createMemoryStorage();
}

let ydocUpdateCallback = env.getConf("ydoc-update-callback");
if (ydocUpdateCallback != null && ydocUpdateCallback.slice(-1) !== "/") {
  ydocUpdateCallback += "/";
}

/**
 * @type {(room: string, ydoc: Y.Doc) => Promise<void>}
 */
const updateCallback = async (room, ydoc) => {
  if (ydocUpdateCallback != null) {
    // call YDOC_UPDATE_CALLBACK here
    const formData = new FormData();
    // @todo only convert ydoc to updatev2 once
    formData.append("ydoc", new Blob([Y.encodeStateAsUpdateV2(ydoc)]));
    // @todo should add a timeout to fetch (see fetch signal abortcontroller)
    const res = await fetch(new URL(room, ydocUpdateCallback), {
      body: formData,
      method: "PUT",
    });
    if (!res.ok) {
      console.error(
        `Issue sending data to YDOC_UPDATE_CALLBACK. status="${res.status}" statusText="${res.statusText}"`
      );
    }
  }
};

yredis.createWorker(store, redisPrefix, {
  updateCallback,
});
