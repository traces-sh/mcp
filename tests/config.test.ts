import { afterEach, describe, expect, test } from "bun:test";
import { apiUrl, authorizationServer, publicUrl } from "../src/config.js";

const originalEnv = {
  MCP_AUTHORIZATION_SERVER: process.env.MCP_AUTHORIZATION_SERVER,
  MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
  TRACES_API_URL: process.env.TRACES_API_URL,
};

function restore(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function cleanup() {
  restore("MCP_AUTHORIZATION_SERVER");
  restore("MCP_PUBLIC_URL");
  restore("TRACES_API_URL");
}

afterEach(cleanup);

describe("service configuration", () => {
  test("uses the hosted service defaults", () => {
    delete process.env.MCP_AUTHORIZATION_SERVER;
    delete process.env.MCP_PUBLIC_URL;
    delete process.env.TRACES_API_URL;

    expect(apiUrl()).toBe("https://agent.traces.com");
    expect(publicUrl()).toBe("http://localhost:3001");
    expect(authorizationServer()).toBe("https://auth.traces.com");
  });

  test("allows HTTP for local services", () => {
    process.env.MCP_AUTHORIZATION_SERVER = "http://127.0.0.1:3211";

    expect(authorizationServer()).toBe("http://127.0.0.1:3211");
  });

  test("rejects insecure remote and non-origin URLs", () => {
    process.env.MCP_AUTHORIZATION_SERVER = "http://auth.example.com";
    expect(() => authorizationServer()).toThrow("must use HTTPS");

    process.env.MCP_AUTHORIZATION_SERVER = "https://auth.example.com/oauth";
    expect(() => authorizationServer()).toThrow("must be an origin");
  });
});
