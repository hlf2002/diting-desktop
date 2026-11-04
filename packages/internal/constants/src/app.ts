// The name authenticator apps show for the account; the server would fall back to "Follow"
export const TOTP_ISSUER = "谛听"

export const APPLE_APP_STORE_ID = "6739802604"
export const GOOGLE_PLAY_PACKAGE_ID = "cn.com.diting"

export const APP_STORE_URLS = {
  iOS: `https://apps.apple.com/us/app/folo-follow-everything/id${APPLE_APP_STORE_ID}`,
  Android: `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_PACKAGE_ID}`,
} as const
