/* =========================================================
   La cucharita · Agente formateador de recetas
   ---------------------------------------------------------
   - Cada regla es un objeto de la lista REGLAS.
   - Para QUITAR una regla: pon  activa: false  (o bórrala).
   - Para AÑADIR una regla: copia la plantilla del final.
   - Las reglas se ejecutan en el orden de la lista.
   - Si una regla devuelve un texto, aparece en el resumen
     "Qué ha hecho el agente".
   ========================================================= */

// ---------- Diccionarios (amplíalos libremente) ----------
const VERBOS = {
  machacar: "Machaca", mezclar: "Mezcla", llevar: "Lleva", añadir: "Añade",
  cortar: "Corta", picar: "Pica", pelar: "Pela", hornear: "Hornea",
  freir: "Fríe", freír: "Fríe", cocer: "Cuece", batir: "Bate", servir: "Sirve",
  poner: "Pon", echar: "Echa", calentar: "Calienta", dejar: "Deja",
  remover: "Remueve", triturar: "Tritura", salpimentar: "Salpimenta",
  rallar: "Ralla", dorar: "Dora", saltear: "Saltea", sofreir: "Sofríe",
  sofreír: "Sofríe", rellenar: "Rellena", untar: "Unta", escurrir: "Escurre",
  incorporar: "Incorpora", reservar: "Reserva", tostar: "Tuesta", hervir: "Hierve",
  extender: "Extiende", cubrir: "Cubre", espolvorear: "Espolvorea", gratinar: "Gratina"
};

const INGREDIENTES = [
  "patatas de bote", "patatas", "parmesano", "pasta de trufa", "bacon", "queso",
  "huevos", "huevo", "harina", "azúcar", "leche", "nata", "mantequilla", "aceite",
  "cebolla", "ajo", "tomate", "pimiento", "pollo", "arroz", "pasta", "atún",
  "limón", "yogur", "aguacate", "calabacín", "calabaza", "jamón", "champiñones",
  "espinacas", "zanahoria", "pan", "chocolate", "fresas", "plátano", "nueces"
];

const BASICOS = ["agua", "sal", "pimienta", "aceite"];

const EMOJIS = [
  [/patata/i, "🥔"], [/pasta|espagueti|macarr/i, "🍝"], [/tarta|bizcocho/i, "🍰"],
  [/pollo/i, "🍗"], [/huevo|tortilla/i, "🍳"], [/sopa|crema|caldo/i, "🍲"],
  [/ensalada/i, "🥗"], [/pizza/i, "🍕"], [/arroz|paella/i, "🥘"], [/fresa/i, "🍓"],
  [/chocolate/i, "🍫"], [/pan|tostada/i, "🍞"], [/queso/i, "🧀"]
];

const COLORES = ["peach", "mint", "lilac", "butter", "blue", "rose"];

// ---------- Utilidades ----------
const mayus = t => t ? t.charAt(0).toLocaleUpperCase("es") + t.slice(1) : t;
const sinPunto = t => t.replace(/[.!?;,]+$/, "").trim();
const quitarTildes = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const listaVerbos = Object.keys(VERBOS).join("|");
const CONECTORES = /^(?:tras eso|después|despues|luego|a continuación|a continuacion|por último|por ultimo|finalmente|y)\s*,?\s*/i;

// ---------- REGLAS ----------
const REGLAS = [
  {
    id: "extraer-secciones",
    nombre: "Separa título, categoría, tiempo e ingredientes del texto",
    activa: true,
    aplicar(r) {
      if (!r.texto) return;
      const timeMatch = r.texto.match(/\b(?:tiempo(?:\s+de\s+preparaci[oó]n)?|duraci[oó]n|tarda)\s*:?\s*((?:\d+\s*(?:horas?|hrs?|h)(?=\s|$)(?:\s*\d+\s*(?:min(?:utos?)?))?)|(?:\d+\s*(?:min(?:utos?)?)))/i);
      const categoryMatch = r.texto.match(/\bcategor[ií]a\s*:?\s*(desayuno|comida|cena|postre)\b/i);
      const preparedText = r.texto
        .replace(/([.!?])\s+(?=(?:ingredientes?|elaboraci[oó]n|preparaci[oó]n|lista de la compra|lista de compras|categor[ií]a|tiempo(?: de preparaci[oó]n)?|duraci[oó]n)\b)/gi, "$1\n")
        .replace(/(,|\s)(?=(?:ingredientes?|elaboraci[oó]n|preparaci[oó]n|lista de la compra|lista de compras|categor[ií]a|tiempo(?: de preparaci[oó]n)?|duraci[oó]n)\s*:)/gi, "\n");
      const sections = { ingredients: [], steps: [], shoppingList: [] };
      const sectionPattern = /^\s*(ingredientes?|elaboraci[oó]n|preparaci[oó]n|lista de la compra|lista de compras|categor[ií]a|tiempo(?: de preparaci[oó]n)?|duraci[oó]n)\s*:?\s*(.*)$/i;
      const lines = preparedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      let activeSection = "";
      const unsectioned = [];

      for (const line of lines) {
        const match = line.match(sectionPattern);
        if (match) {
          const label = match[1].toLocaleLowerCase("es");
          activeSection = label.startsWith("ingrediente")
            ? "ingredients"
            : label.startsWith("elaboraci") || label.startsWith("preparaci")
              ? "steps"
              : label.startsWith("lista")
                ? "shoppingList"
                : "";
          if (activeSection && match[2]) sections[activeSection].push(match[2]);
          continue;
        }
        if (activeSection) sections[activeSection].push(line);
        else unsectioned.push(line);
      }

      const hasSectionHeadings = lines.some(line => sectionPattern.test(line));
      const statements = unsectioned.flatMap(line => line.split(/(?<=[.!?])\s+/)).filter(Boolean);
      const title = (hasSectionHeadings ? unsectioned.shift() : statements.shift()) || "";
      const cleanTitle = title
        .replace(/^(?:receta(?:\s+de)?|hoy\s+(?:vamos\s+a\s+)?(?:preparar|hacer))\s*:?\s*/i, "")
        .replace(/^#\s*/, "")
        .replace(/[.!?]+$/, "")
        .trim();
      const toItems = values => values.join("\n")
        .split(/\r?\n|[;,]|\s+y\s+(?=(?:\d|un\b|una\b|unos\b|unas\b|medio\b|media\b|una pizca\b|un puñado\b))/i)
        .map(item => item.replace(/^[\s•*-]+/, "").trim().replace(/[.!?]+$/, ""))
        .filter(Boolean);

      if (!r.title && cleanTitle) r.title = cleanTitle;
      if (categoryMatch) r.category = categoryMatch[1].toLocaleLowerCase("es");
      if (!r.time && timeMatch) r.time = timeMatch[1];
      if (!r.ingredients.length) {
        if (sections.ingredients.length) {
          r.ingredients = toItems(sections.ingredients);
        } else {
          const transcript = (hasSectionHeadings ? unsectioned : statements).join(" ");
          const ingredientCue = /\b(?:los ingredientes(?: son)?|ingredientes|necesitamos|vamos a necesitar|vas a necesitar)\s*[:,]?\s*/i;
          const cueMatch = transcript.match(ingredientCue);
          if (cueMatch) {
            const start = cueMatch.index + cueMatch[0].length;
            const stepsStart = transcript.slice(start).search(/\b(?:para empezar|empezamos|primero|después|a continuación|luego|elaboraci[oó]n|preparaci[oó]n)\b/i);
            const ingredientText = stepsStart < 0
              ? transcript.slice(start)
              : transcript.slice(start, start + stepsStart);
            r.ingredients = toItems([ingredientText]);
          }
        }
      }
      if (!r.steps.length) {
        r.steps = sections.steps.length
          ? sections.steps.join("\n").split(/(?<=[.!?])\s+/).map(step => step.trim()).filter(Boolean)
          : statements.filter(statement => !/\b(?:los ingredientes(?: son)?|ingredientes|necesitamos|vamos a necesitar|vas a necesitar)\b/i.test(statement));
      }
      if (!r.shoppingList.length) r.shoppingList = toItems(sections.shoppingList);
    }
  },
  {
    id: "normalizar-unidades",
    nombre: "Normaliza unidades (min, °C, g, ml)",
    activa: true,
    aplicar(r) {
      const fix = t => t
        .replace(/(\d+)\s*(?:mins?|minutos?)\b\.?/gi, "$1 min")
        .replace(/(\d+)\s*[ºo°]\s*c?\b/gi, "$1 °C")
        .replace(/(\d+)\s*(?:gr|grs|gramos)\b\.?/gi, "$1 g")
        .replace(/(\d+)\s*(?:mililitros)\b/gi, "$1 ml")
        .replace(/(\d+)\s*(?:horas?|hrs?)\b/gi, "$1 h");
      const antes = JSON.stringify(r);
      r.texto = fix(r.texto);
      r.time = fix(r.time).replace(/\s+/g, " ").trim();
      const timeMatch = r.time.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?$/i);
      if (r.time && timeMatch) {
        const total = Number(timeMatch[1] || 0) * 60 + Number(timeMatch[2] || 0);
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        r.time = hours ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
      } else if (/^\d+$/.test(r.time)) {
        r.time = `${Number(r.time)} min`;
      }
      r.steps = r.steps.map(fix);
      r.ingredients = r.ingredients.map(fix);
      r.shoppingList = r.shoppingList.map(fix);
      if (JSON.stringify(r) !== antes) return "Unidades normalizadas (min, °C…)";
    }
  },
  {
    id: "pasos-desde-texto",
    nombre: "Separa el texto libre en pasos (uno por acción)",
    activa: true,
    aplicar(r) {
      if (r.steps.length) return;
      const frases = r.texto.split(/(?<=[.!?])\s+|\n+/);
      const corte = new RegExp(`\\s*(?:,|\\by\\b)\\s*(?=(?:${listaVerbos})\\b)`, "i");
      r.steps = frases
        .flatMap(f => f.split(corte))
        .map(p => sinPunto(p.trim().replace(CONECTORES, "")))
        .filter(p => p.length > 2);
      if (r.steps.length) return `Texto dividido en ${r.steps.length} pasos`;
    }
  },
  {
    id: "pasos-imperativo",
    nombre: "Pasos en imperativo (tú), con mayúscula y punto",
    activa: true,
    aplicar(r) {
      const corte = new RegExp(`\\s*(?:,|\\by\\b)\\s*(?=(?:${listaVerbos})\\b)`, "i");
      r.steps = r.steps.flatMap(p => p.split(corte)).map(p => {
        const m = p.match(/^(\S+)(.*)$/);
        const verbo = m && (VERBOS[m[1].toLocaleLowerCase("es")] || VERBOS[quitarTildes(m[1].toLowerCase())]);
        const frase = verbo ? verbo + m[2] : mayus(p);
        return sinPunto(frase) + ".";
      });
      if (r.steps.length) return "Pasos redactados en imperativo";
    }
  },
  {
    id: "ingredientes-desde-pasos",
    nombre: "Detecta ingredientes conocidos si no hay lista",
    activa: true,
    aplicar(r) {
      if (r.ingredients.length) return;
      let texto = r.texto.toLocaleLowerCase("es");
      const encontrados = [];
      // Los más largos primero ("patatas de bote" antes que "patatas")
      [...INGREDIENTES].sort((a, b) => b.length - a.length).forEach(ing => {
        const re = new RegExp(`\\b${ing}\\b`, "i");
        if (re.test(texto)) { encontrados.push(ing); texto = texto.replace(new RegExp(`\\b${ing}\\b`, "gi"), " "); }
      });
      // Respetar el orden en que aparecen en el texto
      const orig = r.texto.toLocaleLowerCase("es");
      r.ingredients = encontrados.sort((a, b) => orig.indexOf(a) - orig.indexOf(b)).map(mayus);
      if (r.ingredients.length) return `Detectados ${r.ingredients.length} ingredientes (revisa cantidades)`;
    }
  },
  {
    id: "ingredientes-limpios",
    nombre: "Ingredientes con mayúscula, sin viñetas ni duplicados",
    activa: true,
    aplicar(r) {
      const vistos = new Set();
      r.ingredients = r.ingredients
        .map(i => mayus(sinPunto(i.replace(/^[\s•*\-–]+/, ""))))
        .filter(i => i && !vistos.has(i.toLowerCase()) && vistos.add(i.toLowerCase()));
    }
  },
  {
    id: "tiempo-total",
    nombre: "Calcula el tiempo sumando los minutos de los pasos",
    activa: true,
    aplicar(r) {
      if (r.time) return;
      const total = r.steps.reduce((s, p) =>
        s + [...p.matchAll(/(\d+)\s*min/gi)].reduce((a, m) => a + Number(m[1]), 0), 0);
      if (!total) {
        r.time = "A tu ritmo";
        return;
      }
      const h = Math.floor(total / 60), m = total % 60;
      r.time = h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
      return `Tiempo estimado: ${r.time} (cocción indicada en los pasos)`;
    }
  },
  {
    id: "receta-rapida",
    nombre: "Marca como rápida si son 30 min o menos",
    activa: true,
    aplicar(r) {
      const m = (r.time || "").match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?$/);
      const min = m ? Number(m[1] || 0) * 60 + Number(m[2] || 0) : 0;
      r.quick = min > 0 && min <= 30;
      if (r.quick) return "Marcada como «En un ratito»";
    }
  },
  {
    id: "titulo-sugerido",
    nombre: "Propone un título si no se ha indicado",
    activa: true,
    aplicar(r) {
      if (r.title || !r.ingredients.length) return;
      const [a, b, c] = r.ingredients.map(i => i.toLocaleLowerCase("es"));
      r.title = mayus(b ? `${a} con ${b}${c ? ` y ${c}` : ""}` : a).slice(0, 70);
      return `Título propuesto: «${r.title}»`;
    }
  },
  {
    id: "categoria",
    nombre: "Deduce la categoría por palabras clave",
    activa: true,
    aplicar(r) {
      const t = `${r.title} ${r.texto}`.toLowerCase();
      if (/bizcocho|tarta|galleta|helado|flan|azúcar|chocolate/.test(t)) r.category = "Postre";
      else if (/tostada|desayuno|tortitas|porridge|cereales/.test(t)) r.category = "Desayuno";
      else if (/cena|crema|sopa/.test(t)) r.category = "Cena";
      else r.category = r.category || "Comida";
    }
  },
  {
    id: "emoji-y-color",
    nombre: "Elige emoji según el plato y color por turnos",
    activa: true,
    aplicar(r, ctx) {
      const t = `${r.title} ${r.ingredients.join(" ")}`;
      r.emoji = (EMOJIS.find(([re]) => re.test(t)) || [, "🍽️"])[1];
      r.color = COLORES[(ctx.totalRecetas || 0) % COLORES.length];
    }
  },
  {
    id: "lista-compra",
    nombre: "Lista de la compra sin básicos ni duplicados",
    activa: true,
    aplicar(r) {
      const items = r.shoppingList.length ? r.shoppingList : r.ingredients;
      const vistos = new Set();
      r.shoppingList = items
        .map(i => i.replace(/^\d+[\d.,/]*\s*(?:g|kg|ml|l|uds?|cucharadas?|cucharaditas?|vasos?|tazas?)?\s*(?:de\s+)?/i, ""))
        .map(mayus)
        .filter(i => {
          const normalized = i.toLocaleLowerCase("es");
          return i && !BASICOS.includes(normalized) && !vistos.has(normalized) && vistos.add(normalized);
        });
    }
  },
  {
    id: "descripcion",
    nombre: "Genera una descripción corta (no copia el primer paso)",
    activa: true,
    aplicar(r) {
      if (r.description) return;
      const lugar = /airfryer/i.test(r.texto) ? "hecho en airfryer" : /horno|hornea/i.test(r.texto) ? "al horno" : "casero";
      r.description = `Un plato ${lugar}${r.quick ? ", listo en un momento" : ""}.`;
    }
  }

  /* ---------- PLANTILLA PARA UNA REGLA NUEVA ----------
  ,{
    id: "mi-regla",
    nombre: "Qué hace la regla",
    activa: true,
    aplicar(r, ctx) {
      // r = { texto, title, category, time, ingredients[], steps[],
      //       shoppingList[], description, emoji, color, quick }
      // Modifica r y, si quieres, devuelve un texto para el resumen.
    }
  }
  ------------------------------------------------------ */
];

// ---------- Motor del agente ----------
function formatearReceta(entrada, ctx = {}) {
  const r = {
    texto: entrada.texto || "",
    title: entrada.title || "",
    category: entrada.category || "",
    time: entrada.time || "",
    ingredients: entrada.ingredients || [],
    steps: entrada.steps || [],
    shoppingList: entrada.shoppingList || [],
    description: entrada.description || "", emoji: "", color: "", quick: false
  };
  const log = [];
  for (const regla of REGLAS) {
    if (!regla.activa) continue;
    try {
      const msg = regla.aplicar(r, ctx);
      if (msg) log.push(msg);
    } catch (e) {
      console.warn(`La regla «${regla.id}» ha fallado y se ha saltado.`, e);
    }
  }
  return { receta: r, log };
}

if (typeof module !== "undefined") module.exports = { formatearReceta, REGLAS };