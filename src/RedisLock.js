const { createClient } = require('redis');

export class RedisLock {
  constructor() {
    this.client = createClient({
      url: process.env.REDIS_PARAMSTORE_URL
    });
    this.client.on('error', (err) => console.error('Redis Client Error', err));
    this.lockKey = `parse-server:${process.env.NODE_ENV || 'local'}:init-lock`;
    this.lockTtl = 300000; // 5 minutes in ms
  }

  async acquireLock() {
    try {
      await this.client.connect();
      // Try to set the lock with NX (only if not exists) and EX (expire time)
      const result = await this.client.set(
        this.lockKey, 
        'locked', 
        { NX: true, PX: this.lockTtl }
      );
      return result === 'OK';
    } finally {
      await this.client.quit();
    }
  }
}