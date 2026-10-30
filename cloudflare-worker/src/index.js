const allowedColors = new Set(["peach", "mint", "lilac", "butter", "blue", "rose"]);
const allowedCategories = new Set(["Desayuno", "Comida", "Cena", "Postre"]);
const maxRecipes = 300;
const maxCatalogBytes = 900_000;
const sessionLifetimeSeconds = 2 * 60 * 60;
const textEncoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth/login" && request.method === "GET") {
      try {
        return await startLogin(request, env);
      } catch (error) {
        console.error("No se pudo iniciar la autenticación de GitHub.", error);
        return new Response("El inicio de sesión no está configurado correctamente.", {
          status: error instanceof ApiError ? error.status : 500,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      try {
        return await finishLogin(request, env);
      } catch (error) {
        console.error("No se pudo procesar la respuesta de autenticación de GitHub.", error);
        return new Response("No se pudo completar el inicio de sesión.", {
          status: error instanceof ApiError ? error.status : 500,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.headers.get("Origin") !== env.SITE_ORIGIN) {
        return jsonResponse({ error: "Origen no permitido." }, 403);
      }
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(env)
        });
      }
      return handleApiRequest(request, env, url);
    }

    return new Response("Not found", { status: 404 });
  }
};

async function handleApiRequest(request, env, url) {
  const headers = corsHeaders(env);
  if (url.pathname === "/api/session" && request.method === "GET") {
    const session = await getSession(request, env);
    return jsonResponse({ authenticated: Boolean(session) }, session ? 200 : 401, headers);
  }

  const session = await getSession(request, env);
  if (!session) {
    return jsonResponse({ error: "La sesión de administradora no es válida o ha caducado." }, 401, headers);
  }

  try {
    if (url.pathname === "/api/recipes" && request.method === "POST") {
      const body = await readJsonBody(request);
      const newRecipe = normalizeRecipe(body.recipe, false);
      const recipes = await readCatalog(env);
      if (recipes.length >= maxRecipes) {
        return jsonResponse({ error: `El catálogo no puede superar ${maxRecipes} recetas.` }, 400, headers);
      }
      newRecipe.id = Math.max(0, ...recipes.map(recipe => recipe.id)) + 1;
      newRecipe.favorite = false;
      recipes.unshift(newRecipe);
      return await writeCatalog(env, recipes, headers);
    }

    if (url.pathname === "/api/recipes" && request.method === "PUT") {
      const body = await readJsonBody(request);
      if (!Array.isArray(body.recipes) || body.recipes.length > maxRecipes) {
        return jsonResponse({ error: `Envía una lista de hasta ${maxRecipes} recetas.` }, 400, headers);
      }
      const recipes = body.recipes.map(recipe => normalizeRecipe(recipe, true));
      const ids = new Set(recipes.map(recipe => recipe.id));
      if (ids.size !== recipes.length) {
        return jsonResponse({ error: "El catálogo contiene identificadores repetidos." }, 400, headers);
      }
      return await writeCatalog(env, recipes, headers);
    }

    const deleteMatch = url.pathname.match(/^\/api\/recipes\/(\d+)$/);
    if (deleteMatch && request.method === "DELETE") {
      const id = Number(deleteMatch[1]);
      const recipes = await readCatalog(env);
      const updatedRecipes = recipes.filter(recipe => recipe.id !== id);
      if (updatedRecipes.length === recipes.length) {
        return jsonResponse({ error: "No se encontró esa receta." }, 404, headers);
      }
      return await writeCatalog(env, updatedRecipes, headers);
    }

    return jsonResponse({ error: "Ruta no encontrada." }, 404, headers);
  } catch (error) {
    console.error("Error al procesar el catálogo de recetas.", error);
    const status = error instanceof ApiError ? error.status : 502;
    return jsonResponse({ error: error.message || "No se pudo actualizar el catálogo." }, status, headers);
  }
}

async function startLogin(request, env) {
  assertOAuthConfig(env);
  const callbackUrl = new URL(env.GITHUB_OAUTH_CALLBACK_URL);
  if (callbackUrl.origin !== new URL(request.url).origin || callbackUrl.pathname !== "/auth/callback") {
    return new Response("La URL de retorno OAuth no coincide con este Worker.", { status: 500 });
  }

  const state = randomToken(32);
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl.href);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.href,
      "Cache-Control": "no-store",
      "Set-Cookie": `__Host-la-cucharita-oauth=${state}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax`
    }
  });
}

async function finishLogin(request, env) {
  assertOAuthConfig(env);
  const callbackUrl = new URL(env.GITHUB_OAUTH_CALLBACK_URL);
  const requestUrl = new URL(request.url);
  if (callbackUrl.origin !== requestUrl.origin || callbackUrl.pathname !== requestUrl.pathname) {
    return new Response("La URL de retorno OAuth no coincide con este Worker.", { status: 400 });
  }

  const state = requestUrl.searchParams.get("state");
  const expectedState = readCookie(request.headers.get("Cookie"), "__Host-la-cucharita-oauth");
  const clearStateCookie = "__Host-la-cucharita-oauth=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
  if (!state || !expectedState || state !== expectedState) {
    return new Response("No se pudo verificar el inicio de sesión. Vuelve a intentarlo.", {
      status: 403,
      headers: { "Set-Cookie": clearStateCookie, "Cache-Control": "no-store" }
    });
  }

  if (requestUrl.searchParams.has("error")) {
    return new Response("Se canceló el inicio de sesión con GitHub.", {
      status: 400,
      headers: { "Set-Cookie": clearStateCookie, "Cache-Control": "no-store" }
    });
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return new Response("GitHub no devolvió un código de autorización.", {
      status: 400,
      headers: { "Set-Cookie": clearStateCookie, "Cache-Control": "no-store" }
    });
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl.href
      })
    });
    if (!tokenResponse.ok) throw new ApiError("GitHub no pudo completar la autenticación.", 502);
    const tokenData = await tokenResponse.json();
    if (typeof tokenData.access_token !== "string") {
      throw new ApiError("GitHub no devolvió un token de acceso válido.", 502);
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "La-Cucharita-Worker",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!userResponse.ok) throw new ApiError("No se pudo verificar la cuenta de GitHub.", 502);
    const user = await userResponse.json();
    if (typeof user.login !== "string" || user.login.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()) {
      return new Response("Esta cuenta de GitHub no está autorizada como administradora.", {
        status: 403,
        headers: { "Set-Cookie": clearStateCookie, "Cache-Control": "no-store" }
      });
    }

    const sessionToken = await createSessionToken(env, user.login);
    const destination = new URL(env.SITE_URL);
    destination.hash = `la-cucharita-session=${encodeURIComponent(sessionToken)}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.href,
        "Set-Cookie": clearStateCookie,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (error) {
    console.error("No se pudo completar el inicio de sesión de GitHub.", error);
    return new Response("No se pudo completar el inicio de sesión. Inténtalo de nuevo.", {
      status: error instanceof ApiError ? error.status : 502,
      headers: { "Set-Cookie": clearStateCookie, "Cache-Control": "no-store" }
    });
  }
}

async function readCatalog(env) {
  const response = await fetch(contentsApiUrl(env), { headers: githubHeaders(env) });
  if (!response.ok) {
    throw new ApiError(response.status === 404
      ? "No se encontró el JSON de recetas en el repositorio."
      : "GitHub no pudo leer el catálogo.", 502);
  }

  const file = await response.json();
  if (typeof file.sha !== "string" || typeof file.content !== "string") {
    throw new ApiError("GitHub devolvió un archivo de recetas no válido.", 502);
  }
  let catalog;
  try {
    const decoded = atob(file.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    catalog = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new ApiError("El JSON publicado no se puede leer como un catálogo válido.", 502, error);
  }
  if (!Array.isArray(catalog) || catalog.length > maxRecipes) {
    throw new ApiError("El JSON publicado no contiene una lista de recetas válida.", 502);
  }
  let recipes;
  try {
    recipes = catalog.map(recipe => normalizeRecipe(recipe, true));
  } catch (error) {
    throw new ApiError("El JSON publicado contiene una receta no válida.", 502, error);
  }
  if (new Set(recipes.map(recipe => recipe.id)).size !== recipes.length) {
    throw new ApiError("El JSON publicado contiene identificadores repetidos.", 502);
  }
  return recipes;
}

async function writeCatalog(env, recipes, cors) {
  const content = `${JSON.stringify(recipes, null, 2)}\n`;
  const bytes = textEncoder.encode(content);
  if (bytes.length > maxCatalogBytes) {
    return jsonResponse({
      error: `El catálogo supera el límite de ${maxCatalogBytes} bytes. Reduce el tamaño de las fotos o del contenido.`
    }, 413, cors);
  }

  const existingResponse = await fetch(contentsApiUrl(env), { headers: githubHeaders(env) });
  if (!existingResponse.ok) {
    throw new ApiError("GitHub no pudo preparar la actualización del catálogo.", 502);
  }
  const existingFile = await existingResponse.json();
  if (typeof existingFile.sha !== "string") {
    throw new ApiError("GitHub no devolvió la versión actual del catálogo.", 502);
  }

  const updateResponse = await fetch(contentsApiUrl(env), {
    method: "PUT",
    headers: { ...githubHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Actualizar catálogo de recetas",
      content: encodeBase64(bytes),
      sha: existingFile.sha,
      branch: env.GITHUB_BRANCH
    })
  });
  if (updateResponse.status === 409 || updateResponse.status === 422) {
    return jsonResponse({
      error: "El catálogo cambió durante esta operación. Recarga la página y vuelve a intentarlo."
    }, 409, cors);
  }
  if (!updateResponse.ok) {
    const detail = await updateResponse.text();
    console.error("GitHub rechazó la actualización del catálogo.", updateResponse.status, detail);
    throw new ApiError("GitHub no pudo guardar las recetas. Comprueba los permisos del token.", 502);
  }

  return jsonResponse({ recipes }, 200, cors);
}

async function readJsonBody(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("El contenido debe enviarse como JSON.", 415);
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxCatalogBytes) {
    throw new ApiError("El contenido supera el límite permitido.", 413);
  }
  const rawBody = await request.text();
  if (textEncoder.encode(rawBody).length > maxCatalogBytes) {
    throw new ApiError("El contenido supera el límite permitido.", 413);
  }
  try {
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Se esperaba un objeto JSON.");
    }
    return body;
  } catch (error) {
    throw new ApiError("El contenido no es JSON válido.", 400, error);
  }
}

function normalizeRecipe(recipe, requireId) {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
    throw new ApiError("Hay una receta con formato no válido.", 400);
  }
  const normalized = {
    title: boundedString(recipe.title, 120, "título"),
    category: boundedString(recipe.category, 30, "categoría"),
    time: boundedString(recipe.time, 80, "tiempo"),
    emoji: boundedString(recipe.emoji, 16, "emoji"),
    color: recipe.color,
    description: boundedString(recipe.description, 500, "descripción"),
    ingredients: stringList(recipe.ingredients, "ingredientes", 100, 300),
    steps: stringList(recipe.steps, "pasos", 100, 2_000),
    shoppingList: recipe.shoppingList === undefined
      ? stringList(recipe.ingredients, "ingredientes", 100, 300)
      : stringList(recipe.shoppingList, "lista de la compra", 100, 300),
    favorite: recipe.favorite,
    quick: recipe.quick
  };

  if (!allowedCategories.has(normalized.category) || !allowedColors.has(normalized.color)) {
    throw new ApiError("La categoría o el color de una receta no están permitidos.", 400);
  }
  if (typeof normalized.favorite !== "boolean" || typeof normalized.quick !== "boolean") {
    throw new ApiError("Los indicadores de una receta no tienen el formato esperado.", 400);
  }
  if (requireId) {
    if (!Number.isSafeInteger(recipe.id) || recipe.id < 1) {
      throw new ApiError("El identificador de una receta no es válido.", 400);
    }
    normalized.id = recipe.id;
  }
  if (recipe.sourceUrl !== undefined) {
    if (typeof recipe.sourceUrl !== "string" || recipe.sourceUrl.length > 2_048) {
      throw new ApiError("El enlace de una receta no es válido.", 400);
    }
    try {
      const sourceUrl = new URL(recipe.sourceUrl);
      if (!["http:", "https:"].includes(sourceUrl.protocol)) throw new Error("Protocolo no válido.");
      normalized.sourceUrl = sourceUrl.href;
    } catch (error) {
      throw new ApiError("El enlace de una receta no es válido.", 400, error);
    }
  }
  if (recipe.image !== undefined) {
    if (typeof recipe.image !== "string"
      || recipe.image.length > 700_000
      || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(recipe.image)) {
      throw new ApiError("La foto debe ser una imagen JPEG válida y no superar el límite permitido.", 400);
    }
    normalized.image = recipe.image;
  }
  return normalized;
}

function boundedString(value, maxLength, label) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ApiError(`El campo ${label} no tiene un formato válido.`, 400);
  }
  return value;
}

function stringList(value, label, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems
    || !value.every(item => typeof item === "string" && item.length <= maxLength)) {
    throw new ApiError(`La lista de ${label} no tiene un formato válido.`, 400);
  }
  return value;
}

async function getSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!match) return null;
  try {
    const [headerPart, payloadPart, signaturePart] = match[1].split(".");
    if (!headerPart || !payloadPart || !signaturePart) return null;
    const unsignedToken = `${headerPart}.${payloadPart}`;
    const key = await importSessionKey(env, ["verify"]);
    const signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signaturePart),
      textEncoder.encode(unsignedToken)
    );
    if (!signatureValid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
    if (payload.iss !== "la-cucharita"
      || payload.sub.toLowerCase() !== env.ADMIN_GITHUB_LOGIN.toLowerCase()
      || !Number.isInteger(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function createSessionToken(env, login) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify({
    iss: "la-cucharita",
    sub: login,
    iat: issuedAt,
    exp: issuedAt + sessionLifetimeSeconds
  })));
  const unsignedToken = `${header}.${payload}`;
  const key = await importSessionKey(env, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(unsignedToken));
  return `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function importSessionKey(env, usages) {
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
  }
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

function assertOAuthConfig(env) {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET
    || !env.GITHUB_OAUTH_CALLBACK_URL || !env.SITE_URL || !env.ADMIN_GITHUB_LOGIN) {
    throw new ApiError("Falta configurar la aplicación OAuth del Worker.", 503);
  }
}

function contentsApiUrl(env) {
  if (!env.GITHUB_OWNER || !env.GITHUB_REPOSITORY || !env.RECIPES_FILE_PATH || !env.GITHUB_BRANCH) {
    throw new Error("Falta configurar el repositorio de recetas en el Worker.");
  }
  const filePath = env.RECIPES_FILE_PATH.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPOSITORY)}/contents/${filePath}`);
  url.searchParams.set("ref", env.GITHUB_BRANCH);
  return url.href;
}

function githubHeaders(env) {
  if (!env.GITHUB_CONTENTS_TOKEN) throw new Error("Falta configurar el token de contenido de GitHub.");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_CONTENTS_TOKEN}`,
    "User-Agent": "La-Cucharita-Worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.SITE_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function readCookie(cookieHeader, name) {
  const prefix = `${name}=`;
  const cookie = (cookieHeader || "").split(";").map(part => part.trim()).find(part => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

function randomToken(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return encodeBase64Url(bytes);
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function encodeBase64Url(bytes) {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class ApiError extends Error {
  constructor(message, status, cause) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
  }
}
