// Initializes a single-node replica set required by Prisma when running against MongoDB
try {
  const status = rs.status();
  if (status.ok === 1) {
    print('Replica set already initialized.');
  } else {
    throw new Error('Replica set not ready, attempting to reconfigure.');
  }
} catch (error) {
  if (error.codeName === 'NotYetInitialized') {
    rs.initiate({
      _id: 'rs0',
      members: [{_id: 0, host: 'mongo:27017'}]
    });
    rs.status();
    print('Replica set rs0 initialized.');
  } else {
    throw error;
  }
}
