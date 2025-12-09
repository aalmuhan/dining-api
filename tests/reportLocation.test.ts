import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DBType, initDBConnection } from "db/db";
import { addLocationDataToDb } from "db/updateLocation";
import { test as baseTest } from "vitest";
import { Pool } from "pg";
import { locationReportsTable, conceptIdToInternalIdTable, locationDataTable } from "db/schema";
import { eq } from "drizzle-orm";
import { ILocation } from "types";

const testLocation: ILocation = {
  name: "Test Cafe",
  acceptsOnlineOrders: false,
  conceptId: 82,
  coordinates: { lat: 40.44, lng: -79.94 },
  description: "A test location",
  today: { year: 2025, month: 1, day: 1 },
  times: [],
  location: "Test Building",
  menu: "menu",
  shortDescription: "Test",
  url: "https://test.com",
  todaysSoups: [],
  todaysSpecials: [],
};

const dbTest = baseTest.extend<{
  ctx: {
    db: DBType;
    container: StartedPostgreSqlContainer;
    pool: Pool;
  };
}>({
  ctx: async ({}, use) => {
    const container = await new PostgreSqlContainer("postgres:17.5")
      .withCopyDirectoriesToContainer([
        {
          source: `${__dirname}/../drizzle`,
          target: "/docker-entrypoint-initdb.d",
        },
      ])
      .start();
    const [pool, db] = initDBConnection(container.getConnectionUri());
    use({ container, pool, db });
  },
});

dbTest.afterEach(({ ctx }) => {
  ctx.pool.end();
  ctx.container.stop();
});

describe("Report Location", () => {
  dbTest("can store a report for a valid location", async ({ ctx: { db } }) => {
    // First, add a location to the database
    const internalId = await addLocationDataToDb(db, testLocation);

    // Now insert a report
    const message = "This location is showing wrong hours";
    const timestamp = "2025-01-09 12:00:00";

    await db.insert(locationReportsTable).values({
      locationId: internalId,
      message: message,
      createdAt: timestamp,
    });

    // Verify the report was stored
    const reports = await db
      .select()
      .from(locationReportsTable)
      .where(eq(locationReportsTable.locationId, internalId));

    expect(reports).toHaveLength(1);
    expect(reports[0].message).toBe(message);
    expect(reports[0].locationId).toBe(internalId);
  });

  dbTest("conceptId maps to internal UUID correctly", async ({ ctx: { db } }) => {
    // Add a location (this should automatically create the conceptId mapping)
    const internalId = await addLocationDataToDb(db, testLocation);

    // Check the mapping table
    const mapping = await db
      .select()
      .from(conceptIdToInternalIdTable)
      .where(eq(conceptIdToInternalIdTable.externalId, String(testLocation.conceptId)));

    expect(mapping).toHaveLength(1);
    expect(mapping[0].internalId).toBe(internalId);
  });

  dbTest("returns empty for invalid conceptId lookup", async ({ ctx: { db } }) => {
    // Try to look up a conceptId that doesn't exist
    const mapping = await db
      .select()
      .from(conceptIdToInternalIdTable)
      .where(eq(conceptIdToInternalIdTable.externalId, "99999"));

    expect(mapping).toHaveLength(0);
  });

  dbTest("can look up location name from internal ID", async ({ ctx: { db } }) => {
    // Add a location
    const internalId = await addLocationDataToDb(db, testLocation);

    // Look up the location by internal ID
    const location = await db
      .select()
      .from(locationDataTable)
      .where(eq(locationDataTable.id, internalId))
      .limit(1);

    expect(location).toHaveLength(1);
    expect(location[0].name).toBe("Test Cafe");
  });

  dbTest("full report flow: conceptId -> internalId -> report", async ({ ctx: { db } }) => {
    // This test simulates the full flow of the /api/report-location endpoint
    const internalId = await addLocationDataToDb(db, testLocation);

    // Step 1: Look up internal ID from conceptId (like the endpoint does)
    const conceptMapping = await db
      .select()
      .from(conceptIdToInternalIdTable)
      .where(eq(conceptIdToInternalIdTable.externalId, String(testLocation.conceptId)))
      .limit(1);

    expect(conceptMapping).toHaveLength(1);
    const foundInternalId = conceptMapping[0].internalId;

    // Step 2: Get location name
    const location = await db
      .select()
      .from(locationDataTable)
      .where(eq(locationDataTable.id, foundInternalId))
      .limit(1);

    expect(location[0].name).toBe("Test Cafe");

    // Step 3: Store the report
    const message = "Hours are incorrect";
    const timestamp = "2025-01-09 14:30:00";

    await db.insert(locationReportsTable).values({
      locationId: foundInternalId,
      message: message,
      createdAt: timestamp,
    });

    // Step 4: Verify report was stored correctly
    const reports = await db.select().from(locationReportsTable);

    expect(reports).toHaveLength(1);
    expect(reports[0].locationId).toBe(internalId);
    expect(reports[0].message).toBe("Hours are incorrect");
    expect(reports[0].createdAt).toBe("2025-01-09 14:30:00");
  });
});
