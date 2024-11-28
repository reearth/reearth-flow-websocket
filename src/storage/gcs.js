import * as Y from "yjs";
import * as random from "lib0/random";
import { Storage } from "@google-cloud/storage";
import * as env from "lib0/environment";
import * as logging from "lib0/logging";
import * as promise from "lib0/promise";

const log = logging.createModuleLogger("@reearth/flow-websocket/gcs");

/**
 * @typedef {import('../storage.js').AbstractStorage} AbstractStorage
 */

/**
 * @param {string} bucketName
 */
export const createGCSStorage = (bucketName) => {
  const projectId = env.ensureConf("gcp-project-id");
  const keyFilename = env.ensureConf("gcp-key-filename");
  return new GCSStorage(bucketName, {
    projectId,
    keyFilename,
  });
};

/**
 * @param {string} room
 * @param {string} docid
 */
export const encodeGCSObjectName = (room, docid, r = random.uuidv4()) =>
  `${encodeURIComponent(room)}/${encodeURIComponent(docid)}/${r}`;

/**
 * @param {string} objectName
 */
export const decodeGCSObjectName = (objectName) => {
  const match = objectName.match(/(.*)\/(.*)\/(.*)$/);
  if (match == null) {
    throw new Error("Malformed y:room stream name!");
  }
  return {
    room: decodeURIComponent(match[1]),
    docid: decodeURIComponent(match[2]),
    r: match[3],
  };
};

/**
 * @typedef {Object} GCSStorageConf
 * @property {string} GCSStorageConf.projectId
 * @property {string} GCSStorageConf.keyFilename
 */

/**
 * @param {import('stream').Stream} stream
 * @return {Promise<Buffer>}
 */
const readStream = (stream) =>
  promise.create((resolve, reject) => {
    /**
     * @type {Array<Buffer>}
     */
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

/**
 * @implements {AbstractStorage}
 */
export class GCSStorage {
  /**
   * @param {string} bucketName
   * @param {GCSStorageConf} conf
   */
  constructor(bucketName, { projectId, keyFilename }) {
    this.bucketName = bucketName;
    this.storage = new Storage({
      projectId,
      keyFilename,
    });
    this.bucket = this.storage.bucket(bucketName);
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @returns {Promise<void>}
   */
  async persistDoc(room, docname, ydoc) {
    const objectName = encodeGCSObjectName(room, docname);
    const file = this.bucket.file(objectName);
    await file.save(Buffer.from(Y.encodeStateAsUpdateV2(ydoc)));
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<{ doc: Uint8Array, references: Array<string> } | null>}
   */
  async retrieveDoc(room, docname) {
    log("retrieving doc room=" + room + " docname=" + docname);
    const prefix = encodeGCSObjectName(room, docname, "");
    const [files] = await this.bucket.getFiles({ prefix });
    const references = files.map((file) => file.name);

    log(
      "retrieved doc room=" +
        room +
        " docname=" +
        docname +
        " refs=" +
        JSON.stringify(references)
    );

    if (references.length === 0) {
      return null;
    }

    let updates = await Promise.all(
      references.map(async (ref) => {
        const [content] = await this.bucket.file(ref).download();
        return content;
      })
    );

    updates = updates.filter((update) => update != null);
    log(
      "retrieved doc room=" +
        room +
        " docname=" +
        docname +
        " updatesLen=" +
        updates.length
    );

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
    const r = await this.retrieveDoc(room, docname);
    return r ? Y.encodeStateVectorFromUpdateV2(r.doc) : null;
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Array<string>} storeReferences
   * @return {Promise<void>}
   */
  async deleteReferences(_room, _docname, storeReferences) {
    await Promise.all(
      storeReferences.map((ref) => this.bucket.file(ref).delete())
    );
  }

  async destroy() {}
}
