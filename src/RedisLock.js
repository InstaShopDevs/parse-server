const { createClient } = require('redis');

export class RedisLock {
  constructor() {
    this.client = createClient({
      url: process.env.REDIS_PARAMSTORE_URL
    });
    this.client.on('error', (err) => console.error('Redis Client Error', err));
    this.isConnected = false;
    this.lockKey = 'parse-server:init-lock';
    this.lockTimeout = 30000; // 30 seconds in ms
    this.retryDelay = 1000; // 1 second between retries
    this.maxRetries = 30; // Max 30 retries (30 seconds total)
  }

  async connect() {
    if (!this.isConnected) {
      await this.client.connect();
      this.isConnected = true;
    }
  }

  async acquireLock(instanceId) {
    await this.connect();
    let retries = 0;
    
    while (retries < this.maxRetries) {
      const result = await this.client.set(
        this.lockKey,
        instanceId,
        {
          NX: true,
          PX: this.lockTimeout
        }
      );
      
      if (result === 'OK') {
        return true;
      }
      
      retries++;
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    }
    
    return false;
  }

  async releaseLock(instanceId) {
    await this.connect();
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    
    return await this.client.eval(script, {
      keys: [this.lockKey],
      arguments: [instanceId]
    });
  }

  async extendLock(instanceId) {
    await this.connect();
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    
    return await this.client.eval(script, {
      keys: [this.lockKey],
      arguments: [instanceId, this.lockTimeout.toString()]
    });
  }

  async disconnect() {
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}