import * as Y from "yjs";
import * as random from "lib0/random";
import { Storage } from "@google-cloud/storage";
import * as logging from "lib0/logging";

const log = logging.createModuleLogger("@reearth/flow-websocket/gcs");

/**
 * @typedef {import('../storage.js').AbstractStorage} AbstractStorage
 */

/**
 * @param {string} bucketName
 */
export const createGCSStorage = (bucketName) => {
  console.log("Creating GCS storage for bucket:", bucketName);
  log("Creating GCS storage for bucket: " + bucketName);
  if (process.env.NODE_ENV === 'test') {
    console.log("Environment is test. Using emulator host for GCS.");
    log("Environment is test. Using emulator host for GCS.");
    return new GCSStorage(bucketName, {
      apiEndpoint: process.env.STORAGE_EMULATOR_HOST || 'http://localhost:4443',
      projectId: 'test-project',
      credentials: { client_email: 'test@test.com', private_key: 'test' },
      useHttps: false 
    });
  }
  console.log("Environment is not test. Using default GCS configuration.");
  log("Environment is not test. Using default GCS configuration.");
  return new GCSStorage(bucketName);
};

/**
 * @param {string} room
 * @param {string} docid
 */
export const encodeGCSObjectName = (room, docid, r = random.uuidv4()) => {
  console.log(`Encoding GCS object name for room=${room}, docid=${docid}, random=${r}`);
  log(`Encoding GCS object name for room: ${room}, docid: ${docid}, random: ${r}`);
  return `${encodeURIComponent(room)}/${encodeURIComponent(docid)}/${r}`;
};

/**
 * @param {string} objectName
 */
export const decodeGCSObjectName = (objectName) => {
  console.log("Decoding GCS object name:", objectName);
  log("Decoding GCS object name: " + objectName);
  const match = objectName.match(/(.*)\/(.*)\/(.*)$/);
  if (match == null) {
    console.error("Malformed GCS object name:", objectName);
    throw new Error("Malformed y:room stream name!");
  }
  const decoded = {
    room: decodeURIComponent(match[1]),
    docid: decodeURIComponent(match[2]),
    r: match[3],
  };
  console.log("Decoded GCS object name:", decoded);
  log("Decoded GCS object name: " + JSON.stringify(decoded));
  return decoded;
};

/**
 * @implements {AbstractStorage}
 */
export class GCSStorage {
  /**
   * @param {string} bucketName
   * @param {Object} [options={}]
   */
  constructor(bucketName, options = {}) {
    console.log("Initializing GCSStorage with bucket:", bucketName);
    log("Initializing GCSStorage with bucket: " + bucketName);
    this.bucketName = bucketName;
    this.storage = new Storage(options);
    this.bucket = this.storage.bucket(bucketName);
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @returns {Promise<void>}
   */
  async persistDoc(room, docname, ydoc) {
    console.log(`Persisting doc: room=${room}, docname=${docname}`);
    log(`Persisting doc: room=${room}, docname=${docname}`);
    const objectName = encodeGCSObjectName(room, docname);
    console.log("Generated objectName for persistDoc:", objectName);
    log(`Generated objectName for persistDoc: ${objectName}`);
    const file = this.bucket.file(objectName);
    await file.save(Buffer.from(Y.encodeStateAsUpdateV2(ydoc)));
    console.log(`Persisted doc: room=${room}, docname=${docname}`);
    log(`Persisted doc: room=${room}, docname=${docname}`);
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<{ doc: Uint8Array, references: Array<string> } | null>}
   */
  async retrieveDoc(room, docname) {
    console.log(`Retrieving doc: room=${room}, docname=${docname}`);
    log(`Retrieving doc: room=${room}, docname=${docname}`);
    const prefix = encodeGCSObjectName(room, docname, "");
    console.log("Searching for files with prefix:", prefix);
    log(`Searching for files with prefix: ${prefix}`);
    const [files] = await this.bucket.getFiles({ prefix });
    const references = files.map((file) => file.name);

    console.log(
      `Found files for doc retrieval: room=${room}, docname=${docname}, refs=`,
      references
    );
    log(
      `Found files for doc retrieval: room=${room}, docname=${docname}, refs=${JSON.stringify(references)}`
    );

    if (references.length === 0) {
      console.warn(`No files found for doc: room=${room}, docname=${docname}`);
      return null;
    }

    let updates = await Promise.all(
      references.map(async (ref) => {
        console.log(`Downloading file: ${ref}`);
        log(`Downloading file: ${ref}`);
        const [content] = await this.bucket.file(ref).download();
        return content;
      })
    );

    updates = updates.filter((update) => update != null);
    console.log(`Merged ${updates.length} updates for doc: room=${room}, docname=${docname}`);
    log(`Merged ${updates.length} updates for doc: room=${room}, docname=${docname}`);

    return {
      doc: Y.mergeUpdatesV2(updates),
      references,
    };
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<Uint8Array|null>}
   */
  async retrieveStateVector(room, docname) {
    console.log(`Retrieving state vector: room=${room}, docname=${docname}`);
    log(`Retrieving state vector: room=${room}, docname=${docname}`);
    const r = await this.retrieveDoc(room, docname);
    if (!r) {
      console.warn(`No doc found for state vector retrieval: room=${room}, docname=${docname}`);
      return null;
    }
    console.log(`State vector retrieved for room=${room}, docname=${docname}`);
    log(`State vector retrieved for room=${room}, docname=${docname}`);
    return Y.encodeStateVectorFromUpdateV2(r.doc);
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Array<string>} storeReferences
   * @return {Promise<void>}
   */
  async deleteReferences(_room, _docname, storeReferences) {
    console.log(`Deleting references: room=${_room}, docname=${_docname}, refs=`, storeReferences);
    log(`Deleting references: room=${_room}, docname=${_docname}, refs=${JSON.stringify(storeReferences)}`);
    await Promise.all(
      storeReferences.map((ref) => {
        console.log(`Deleting file: ${ref}`);
        log(`Deleting file: ${ref}`);
        return this.bucket.file(ref).delete();
      })
    );
    console.log(`Deleted all references for room=${_room}, docname=${_docname}`);
    log(`Deleted all references for room=${_room}, docname=${_docname}`);
  }

  async destroy() {
    console.log("Destroying GCSStorage instance");
    log("Destroying GCSStorage instance");
  }
}
