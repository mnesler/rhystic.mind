import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-jwt-secret";

interface GitHubUser {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  email: string;
}

function generateToken(user: GitHubUser): string {
  return jwt.sign(
    { id: user.id, login: user.login, name: user.name, avatar: user.avatar_url, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function verifyToken(token: string): GitHubUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as GitHubUser;
  } catch {
    return null;
  }
}

describe("Auth", () => {
  describe("JWT Token", () => {
    it("should generate a valid JWT token", () => {
      const user: GitHubUser = {
        id: 123,
        login: "testuser",
        name: "Test User",
        avatar_url: "https://avatars.githubusercontent.com/u/123",
        email: "test@example.com",
      };

      const token = generateToken(user);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3);
    });

    it("should verify a valid token", () => {
      const user: GitHubUser = {
        id: 123,
        login: "testuser",
        name: "Test User",
        avatar_url: "https://avatars.githubusercontent.com/u/123",
        email: "test@example.com",
      };

      const token = generateToken(user);
      const verified = verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified!.id).toBe(123);
      expect(verified!.login).toBe("testuser");
      expect(verified!.name).toBe("Test User");
      expect(verified!.email).toBe("test@example.com");
    });

    it("should return null for invalid token", () => {
      const verified = verifyToken("invalid-token");
      expect(verified).toBeNull();
    });

    it("should return null for tampered token", () => {
      const user: GitHubUser = {
        id: 123,
        login: "testuser",
        name: "Test User",
        avatar_url: "https://avatars.githubusercontent.com/u/123",
        email: "test@example.com",
      };

      const token = generateToken(user);
      const parts = token.split(".");
      const tampered = parts[0] + "." + parts[1] + ".tampered";

      const verified = verifyToken(tampered);
      expect(verified).toBeNull();
    });

    it("should extract user data from token", () => {
      const user: GitHubUser = {
        id: 456,
        login: "mtgplayer",
        name: "MTG Player",
        avatar_url: "https://avatars.githubusercontent.com/u/456",
        email: "mtg@example.com",
      };

      const token = generateToken(user);
      const verified = verifyToken(token);

      expect(verified).toMatchObject({
        id: 456,
        login: "mtgplayer",
        name: "MTG Player",
        email: "mtg@example.com",
      });
    });
  });

  describe("Token expiration", () => {
    it("should create token with 30 day expiration", () => {
      const user: GitHubUser = {
        id: 1,
        login: "test",
        name: "Test",
        avatar_url: "",
        email: "test@test.com",
      };

      const token = generateToken(user);
      const decoded = jwt.decode(token) as { exp: number };

      expect(decoded.exp).toBeDefined();
      
      const now = Math.floor(Date.now() / 1000);
      const thirtyDays = 30 * 24 * 60 * 60;
      expect(decoded.exp - now).toBeGreaterThanOrEqual(thirtyDays - 5);
      expect(decoded.exp - now).toBeLessThanOrEqual(thirtyDays + 5);
    });
  });
});
