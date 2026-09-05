declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    APP_ENV?: string;
    SEMANTIC_PROVIDER?: string;
    TEST_QUESTION_ID?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_AI_API_TOKEN?: string;
    CLOUDFLARE_AI_MODEL?: string;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    AUTH_SECRET?: string;
    TEST_SMS_CODE?: string;
  }
}
