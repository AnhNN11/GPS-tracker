import { MongoMemoryReplSet } from "mongodb-memory-server";
// A disposable local replica set; never run tests against the supplied Atlas URI.
export async function startTestDatabase() {
  const instance = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.MONGODB_URI = instance.getUri();
  process.env.MONGODB_DB = "campus_guard_test";
  return instance;
}
