//#region src/livefeed-host.mjs
function applyLivefeedHost(ctx) {
	const log = ctx.logger || console;
	const CONFIG_DIR = (() => {
		const env = typeof process !== "undefined" && process.env ? process.env : null;
		if (env && env.DSH_LIVEFEED_DIR) return String(env.DSH_LIVEFEED_DIR).replace(/[\\/]+$/, "");
		return (env && (env.USERPROFILE || env.HOME) || ".") + "/.dsh/dsh-livefeed";
	})();
	const CONFIG_FILE = CONFIG_DIR + "/config.json";
	const STATE_FILE = CONFIG_DIR + "/state.json";
	const HISTORY_FILE = CONFIG_DIR + "/history.jsonl";
	const TEMPLATE_FILE = CONFIG_DIR + "/sources/_template.js";
	const ROUTE_PATH = "/api/dsh-livefeed";
	const DEFAULT_INTERVAL_MIN = 30;
	const DEFAULT_FETCH_COUNT = 40;
	const DEFAULT_OUTPUT_COUNT = 8;
	const DEFAULT_RETENTION_DAYS = 3;
	const DEFAULT_MAX_CARDS = 300;
	const RETRY_MAX = 2;
	const RETRY_BASE_MS = 300 * 1e3;
	const TICK_MS = 30 * 1e3;
	const BLOCK_TAGS = ["富可敌国"];
	const BUILTIN_TEMPLATE = atob("Lyog4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAqIGRzaC1saXZlZmVlZCDmkJzntKLmupDln7rnsbvmqKHmnb/vvIhCYXNlIFRlbXBsYXRl77yJCiAqIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogKiBIb3N0IOWwhuacrOaooeadv+S4jua6kOiEmuacrOaLvOaOpe+8iHByb2dyYW0gPSDmqKHmnb8gKyAiXG4iICsg5rqQ6ISa5pys77yJ5ZCO77yM5L2c5Li6CiAqIGNvZGVSdW50aW1lIOeahCBwcm9ncmFtIOi/kOihjOOAgua6kOiEmuacrOWPqumcgOWunueOsO+8mgogKgogKiAgIGFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpICAgLy8g5b+F6YCJ77ya57KX5pCc77yM6L+U5ZueIFt7dGl0bGUsIHVybCwgc25pcHBldD8sIHB1Ymxpc2hlZEF0PywgcmVwbHlDb3VudD8sIHZpZXdzPywgbGlrZXM/LCB0YWdzP31dCiAqICAgYXN5bmMgZnVuY3Rpb24gZmluZVNlYXJjaChhcGksIGl0ZW0pIC8vIOWPr+mAie+8mueyvuaQnO+8jOi/lOWbniB7IHRleHQgfe+8iOm7mOiupOWunueOsOingeS4i++8iQogKgogKiDmqKHmnb/lnKjmlofku7blsL7pg6jms6jlhaXosIPluqblmajvvIzkvp3mja4gYXBpLm1vZGUoKSDliIbmtL7vvJvlvZLkuIDljJYv5oiq5patL+WOu+mHjeeUseaooeadv+e7n+S4gOWujOaIkOOAggogKiDmupDohJrmnKzor7fli7/ph43mlrDlo7DmmI7nrKwgNCDoioLkv53nlZnlkI3vvIjop4EgZG9jcy9zb3VyY2UtY29udHJhY3QubWTvvInjgIIKICog5pys5paH5Lu25pivIEhvc3Qg5YaF572u5qih5p2/5bi46YeP55qE5rqQ5aS077ya5L+u5pS55ZCO6ZyA5ZCM5q2l5YiwIEhvc3Qg5Luj56CB5Lit55qE5qih5p2/5bi46YeP44CCCiAqLwondXNlIHN0cmljdCc7CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5bi46YePCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApjb25zdCBNQVhfQ09OVEVOVF9DSEFSUyA9IDgwMDA7ICAgLy8g57K+5pCc5q2j5paH5LiK6ZmQ77yI5a2X56ym77yJCmNvbnN0IERFRkFVTFRfTUFYX0lURU1TID0gMTU7ICAgICAvLyDnspfmkJzpu5jorqTmnaHnm67kuIrpmZAKCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAovLyDlrZDnsbvlpZHnuqbvvJpjb2Fyc2VTZWFyY2gg5b+F6YCJ77yMZmluZVNlYXJjaCDlj6/pgInvvIjmnInpu5jorqTlrp7njrDvvIkKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACmFzeW5jIGZ1bmN0aW9uIGNvYXJzZVNlYXJjaChhcGkpIHsKICAvLyDpu5jorqTnspfmkJzvvJrpgJrnlKggd2ViLnNlYXJjaCDlnovvvIjmupDohJrmnKzmnKrlrp7njrDkuJTmnKrphY3nva4gcXVlcnkg5pe25oqb6ZSZ5o+Q56S677yJCiAgY29uc3QgY2ZnID0gYXdhaXQgYXBpLmNvbmZpZyhudWxsKTsKICBjb25zdCBxID0gU3RyaW5nKChjZmcgJiYgY2ZnLnF1ZXJ5KSB8fCAnJykudHJpbSgpOwogIGlmICghcSkgewogICAgdGhyb3cgbmV3IEVycm9yKCdbZHNoLWxpdmVmZWVkXSDmnKrlrp7njrAgY29hcnNlU2VhcmNoIOS4lOa6kOacqumFjee9riBxdWVyeScpOwogIH0KICBjb25zdCByID0gYXdhaXQgc2VhcmNoV2ViKGFwaSwgcSwgKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TKTsKICByZXR1cm4gci5tYXAoKHMpID0+ICh7CiAgICB0aXRsZTogcy50aXRsZSB8fCBzLnVybCwKICAgIHVybDogcy51cmwsCiAgICBzbmlwcGV0OiBzLnNuaXBwZXQgfHwgJycsCiAgICBwdWJsaXNoZWRBdDogcy5wdWJsaXNoZWRBdCB8fCB1bmRlZmluZWQsCiAgfSkpOwp9Cgphc3luYyBmdW5jdGlvbiBmaW5lU2VhcmNoKGFwaSwgaXRlbSkgewogIC8vIOm7mOiupOeyvuaQnO+8muaKk+WPluadoeebriBVUkwg5bm25o+Q5Y+W5q2j5paH77yI57qv6ZO+5o6l5YiX6KGo5Z6L5rqQ5peg6ZyA6KaG55uW77yJCiAgY29uc3QgcGFnZSA9IGF3YWl0IGZldGNoUGFnZShhcGksIGl0ZW0udXJsKTsKICByZXR1cm4geyB0ZXh0OiBodG1sVG9UZXh0KHBhZ2UuYm9keS5jb250ZW50LCBNQVhfQ09OVEVOVF9DSEFSUykgfTsKfQoKLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSACi8vIOWFrOWFseW3peWFt++8iOWfuuexu+aWueazle+8jOa6kOiEmuacrOWPr+ebtOaOpeiwg+eUqO+8iQovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLyoqIOWMheijhSBhcGkuc2VhcmNo77yM6L+U5ZueIHNvdXJjZXNbXSAqLwphc3luYyBmdW5jdGlvbiBzZWFyY2hXZWIoYXBpLCBxdWVyeSwgbWF4UmVzdWx0cykgewogIGNvbnN0IHIgPSBhd2FpdCBhcGkuc2VhcmNoKHsKICAgIHF1ZXJ5OiBTdHJpbmcocXVlcnkpLAogICAgbWF4UmVzdWx0czogbWF4UmVzdWx0cyB8fCBERUZBVUxUX01BWF9JVEVNUywKICB9KTsKICByZXR1cm4gKHIgJiYgQXJyYXkuaXNBcnJheShyLnNvdXJjZXMpID8gci5zb3VyY2VzIDogW10pOwp9CgovKiog5YyF6KOFIGFwaS5mZXRjaENvbnRlbnQgKi8KYXN5bmMgZnVuY3Rpb24gZmV0Y2hQYWdlKGFwaSwgdXJsKSB7CiAgcmV0dXJuIGFwaS5mZXRjaENvbnRlbnQoeyB1cmw6IFN0cmluZyh1cmwpIH0pOwp9CgovKiogSFRNTCDlrp7kvZPop6PnoIHvvIjlkKsgPGJyPiDmjaLooYzjgIHljrvmoIfnrb7jgIHmlbDlrZcv5Y2B5YWt6L+b5Yi25a6e5L2T5aaCICYjeDJGO++8iSAqLwpmdW5jdGlvbiBkZWNvZGVFbnRpdGllcyhzKSB7CiAgcmV0dXJuIFN0cmluZyhzKQogICAgLnJlcGxhY2UoLzxiclxzKlwvPz4vZ2ksICdcbicpCiAgICAucmVwbGFjZSgvPFtePl0rPi9nLCAnICcpCiAgICAucmVwbGFjZSgvJm5ic3A7L2dpLCAnICcpCiAgICAucmVwbGFjZSgvJmx0Oy9naSwgJzwnKQogICAgLnJlcGxhY2UoLyZndDsvZ2ksICc+JykKICAgIC5yZXBsYWNlKC8mcXVvdDsvZ2ksICciJykKICAgIC5yZXBsYWNlKC8mI3goWzAtOWEtZkEtRl0rKTsvZywgKG0sIGgpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoaCwgMTYpKSkKICAgIC5yZXBsYWNlKC8mIyhcZCspOy9nLCAobSwgZCkgPT4gU3RyaW5nLmZyb21DaGFyQ29kZShOdW1iZXIoZCkpKQogICAgLnJlcGxhY2UoLyZhbXA7L2dpLCAnJicpOwp9CgovKiog6YCa55SoIEhUTUzihpLmlofmnKzvvJrljrvmoIfnrb7jgIHljovnvKnnqbrnmb3vvIzlj6/pgInmiKrmlq0gKi8KZnVuY3Rpb24gaHRtbFRvVGV4dChodG1sLCBtYXhMZW4pIHsKICBsZXQgdGV4dCA9IGRlY29kZUVudGl0aWVzKGh0bWwpCiAgICAucmVwbGFjZSgvWyBcdF0rL2csICcgJykKICAgIC5yZXBsYWNlKC9cbnszLH0vZywgJ1xuXG4nKQogICAgLnRyaW0oKTsKICBpZiAobWF4TGVuICYmIHRleHQubGVuZ3RoID4gbWF4TGVuKSB0ZXh0ID0gdGV4dC5zbGljZSgwLCBtYXhMZW4pICsgJ+KApic7CiAgcmV0dXJuIHRleHQ7Cn0KCi8qKiDlj5blgLzovoXliqnvvIjlrZfnrKbkuLLplK7miJblh73mlbDvvIkgKi8KZnVuY3Rpb24gcGljayhvYmosIGtleSkgewogIGlmIChrZXkgPT09IG51bGwgfHwga2V5ID09PSB1bmRlZmluZWQpIHJldHVybiAnJzsKICBpZiAodHlwZW9mIGtleSA9PT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGtleShvYmopOwogIGNvbnN0IHYgPSBvYmpba2V5XTsKICByZXR1cm4gdiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQgPyAnJyA6IFN0cmluZyh2KTsKfQoKLyoqIOWwhiBKU09OIEFQSSDliJfooajop4TmlbTkuLogaXRlbXPvvJp7dGl0bGVLZXksIHVybEtleSwgc25pcHBldEtleT8sIHB1Ymxpc2hlZEF0S2V5PywgdXJsRmFsbGJhY2s/fSAqLwpmdW5jdGlvbiBqc29uSXRlbXMobGlzdCwgb3B0cykgewogIGNvbnN0IG8gPSBvcHRzIHx8IHt9OwogIHJldHVybiAoQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3QgOiBbXSkubWFwKCh4KSA9PiAoewogICAgdGl0bGU6IHBpY2soeCwgby50aXRsZUtleSksCiAgICB1cmw6IHBpY2soeCwgby51cmxLZXkpIHx8ICh0eXBlb2Ygby51cmxGYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyA/IHBpY2soeCwgby51cmxGYWxsYmFjaykgOiAnJyksCiAgICBzbmlwcGV0OiBvLnNuaXBwZXRLZXkgPyBwaWNrKHgsIG8uc25pcHBldEtleSkgOiAnJywKICAgIHB1Ymxpc2hlZEF0OiBvLnB1Ymxpc2hlZEF0S2V5ID8gcGljayh4LCBvLnB1Ymxpc2hlZEF0S2V5KSB8fCB1bmRlZmluZWQgOiB1bmRlZmluZWQsCiAgfSkpOwp9CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g5b2S5LiA5YyW77yI5qih5p2/5YaF6YOo77yJCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgApmdW5jdGlvbiBfbm9ybWFsaXplVGl0bGVzKGl0ZW1zLCBjZmcpIHsKICBpZiAoIUFycmF5LmlzQXJyYXkoaXRlbXMpKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoJ1tkc2gtbGl2ZWZlZWRdIGNvYXJzZVNlYXJjaCDlv4Xpobvov5Tlm57mlbDnu4QnKTsKICB9CiAgY29uc3QgbWF4ID0gKGNmZyAmJiBjZmcubWF4SXRlbXMpIHx8IERFRkFVTFRfTUFYX0lURU1TOwogIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7CiAgY29uc3Qgb3V0ID0gW107CiAgZm9yIChjb25zdCBpdCBvZiBpdGVtcykgewogICAgaWYgKCFpdCB8fCB0eXBlb2YgaXQgIT09ICdvYmplY3QnKSBjb250aW51ZTsKICAgIGNvbnN0IHVybCA9IFN0cmluZyhpdC51cmwgfHwgJycpLnRyaW0oKTsKICAgIGNvbnN0IHRpdGxlID0gU3RyaW5nKGl0LnRpdGxlIHx8ICcnKS50cmltKCk7CiAgICBpZiAoIXVybCB8fCAhdGl0bGUgfHwgc2Vlbi5oYXModXJsKSkgY29udGludWU7CiAgICBzZWVuLmFkZCh1cmwpOwogICAgb3V0LnB1c2goewogICAgICB0aXRsZSwKICAgICAgdXJsLAogICAgICBzbmlwcGV0OiBpdC5zbmlwcGV0ID8gU3RyaW5nKGl0LnNuaXBwZXQpLnNsaWNlKDAsIDUwMCkgOiAnJywKICAgICAgcHVibGlzaGVkQXQ6IHR5cGVvZiBpdC5wdWJsaXNoZWRBdCA9PT0gJ3N0cmluZycgPyBpdC5wdWJsaXNoZWRBdCA6IHVuZGVmaW5lZCwKICAgICAgLy8g6ZmE5Yqg5a2X5q6177yI5rqQ6ISa5pys5Y+v5pC65bim77yM5L6bIEhvc3Qg55qEIEFJIOS7t+WAvOetm+mAieS9v+eUqO+8m+e8uuWkseaXtuWuieWFqOWbnumAgO+8iQogICAgICByZXBseUNvdW50OiBOdW1iZXIoaXQucmVwbHlDb3VudCkgfHwgMCwKICAgICAgcG9zdHNDb3VudDogTnVtYmVyKGl0LnBvc3RzQ291bnQpIHx8IDAsCiAgICAgIHZpZXdzOiBOdW1iZXIoaXQudmlld3MpIHx8IDAsCiAgICAgIGxpa2VzOiBOdW1iZXIoaXQubGlrZXMpIHx8IDAsCiAgICAgIHRhZ3M6IEFycmF5LmlzQXJyYXkoaXQudGFncykgPyBpdC50YWdzLm1hcChTdHJpbmcpIDogW10sCiAgICB9KTsKICAgIGlmIChvdXQubGVuZ3RoID49IG1heCkgYnJlYWs7CiAgfQogIHJldHVybiBvdXQ7Cn0KCmZ1bmN0aW9uIF9ub3JtYWxpemVDb250ZW50KG91dCkgewogIGlmICghb3V0IHx8IHR5cGVvZiBvdXQgIT09ICdvYmplY3QnKSB7CiAgICB0aHJvdyBuZXcgRXJyb3IoJ1tkc2gtbGl2ZWZlZWRdIGZpbmVTZWFyY2gg5b+F6aG76L+U5ZueIHsgdGV4dCB9Jyk7CiAgfQogIGNvbnN0IHRleHQgPSBTdHJpbmcob3V0LnRleHQgfHwgJycpLnRyaW0oKTsKICBpZiAoIXRleHQpIHRocm93IG5ldyBFcnJvcignW2RzaC1saXZlZmVlZF0gZmluZVNlYXJjaCDov5Tlm57nmoTmraPmlofkuLrnqbonKTsKICByZXR1cm4geyB0ZXh0OiB0ZXh0LnNsaWNlKDAsIE1BWF9DT05URU5UX0NIQVJTKSB9Owp9CgovLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAKLy8g6LCD5bqm5Zmo77yI5qih5p2/5YaF572u77yb5rqQ6ISa5pys5peg6ZyA5YWz5b+D77yJCi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAphc3luYyBmdW5jdGlvbiBfZHNoTGl2ZWZlZWREaXNwYXRjaGVyKCkgewogIGNvbnN0IG1vZGUgPSBhd2FpdCBhcGkubW9kZShudWxsKTsKICBpZiAobW9kZSA9PT0gJ3RpdGxlcycpIHsKICAgIHJldHVybiBfbm9ybWFsaXplVGl0bGVzKGF3YWl0IGNvYXJzZVNlYXJjaChhcGkpLCBhd2FpdCBhcGkuY29uZmlnKG51bGwpKTsKICB9CiAgaWYgKG1vZGUgPT09ICdjb250ZW50JykgewogICAgY29uc3QgaXRlbSA9IGF3YWl0IGFwaS5pdGVtKG51bGwpOwogICAgcmV0dXJuIF9ub3JtYWxpemVDb250ZW50KGF3YWl0IGZpbmVTZWFyY2goYXBpLCBpdGVtKSk7CiAgfQogIHRocm93IG5ldyBFcnJvcignW2RzaC1saXZlZmVlZF0g5pyq55+l5qih5byPOiAnICsgU3RyaW5nKG1vZGUpKTsKfQoKcmV0dXJuIGF3YWl0IF9kc2hMaXZlZmVlZERpc3BhdGNoZXIoKTsK");
	const state = {
		config: null,
		cards: [],
		seenUrls: /* @__PURE__ */ new Set(),
		archive: [],
		sourceErrors: [],
		cycleStats: null,
		progress: null,
		running: false,
		paused: false,
		retrying: 0,
		lastRunAt: void 0,
		lastError: void 0,
		tick: 0,
		mid: 0,
		cycleStamp: null
	};
	let disposed = false;
	async function fsRead(absPath) {
		try {
			const target = await ctx.fs.resolve(absPath);
			return await ctx.fs.readText(target);
		} catch (_) {
			return null;
		}
	}
	async function fsWrite(absPath, content) {
		try {
			const target = await ctx.fs.resolve(absPath);
			await ctx.fs.writeText(target, content);
			return true;
		} catch (err) {
			log.error("[dsh-livefeed] write failed:", absPath, String(err && err.message || err));
			return false;
		}
	}
	function parseJson(text, fallback) {
		try {
			return text ? JSON.parse(text) : fallback;
		} catch (_) {
			return fallback;
		}
	}
	function jsonSafe(v) {
		if (v === void 0) return null;
		if (v === null || typeof v !== "object") return v;
		if (Array.isArray(v)) return v.map(jsonSafe);
		const out = {};
		for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
		return out;
	}
	function defaultConfig() {
		return {
			intervalMinutes: DEFAULT_INTERVAL_MIN,
			fetchCount: DEFAULT_FETCH_COUNT,
			outputCount: DEFAULT_OUTPUT_COUNT,
			retentionDays: DEFAULT_RETENTION_DAYS,
			maxCards: DEFAULT_MAX_CARDS,
			summaryLanguage: "zh-CN",
			model: null,
			sources: []
		};
	}
	function mergeConfig(base, cfg) {
		if (!cfg || typeof cfg !== "object") return base;
		const out = {};
		for (const k of Object.keys(base)) out[k] = cfg[k] !== void 0 ? cfg[k] : base[k];
		if (!Array.isArray(out.sources)) out.sources = [];
		return out;
	}
	function linuxdoSource(cfg) {
		const found = (cfg && Array.isArray(cfg.sources) ? cfg.sources : []).find((s) => s && String(s.id) === "linuxdo");
		return Object.assign({
			id: "linuxdo",
			name: "Linux Do",
			script: "sources/linuxdo.js",
			query: "",
			enabled: true,
			fetch: "browser",
			maxItems: 200
		}, found || {});
	}
	function normalizeUrl(raw) {
		let s = String(raw || "").trim();
		if (!s) return s;
		s = s.split("#")[0].replace(/\/+$/, "");
		const m = s.match(/^https?:\/\/([^\/]+)(.*)$/i);
		if (m) s = "http://" + m[1].toLowerCase() + m[2];
		return s;
	}
	function resolveModel() {
		const cfgModel = state.config && state.config.model;
		if (cfgModel && cfgModel.provider && cfgModel.model) return {
			provider: cfgModel.provider,
			model: cfgModel.model,
			reasoningEffort: cfgModel.reasoningEffort
		};
		const sel = ctx.agentDefaultModel.currentSelection();
		return {
			provider: sel.provider,
			model: sel.model,
			reasoningEffort: sel.reasoningEffort
		};
	}
	async function callModel(system, userText, maxTokens) {
		const sel = resolveModel();
		const opts = {
			provider: sel.provider,
			model: sel.model,
			system: system || "",
			maxTokens: maxTokens || 3e3,
			messages: [{
				id: "dsh-livefeed-" + ++state.mid,
				role: "user",
				content: [{
					type: "text",
					text: userText
				}],
				source: { kind: "user" }
			}]
		};
		if (sel.reasoningEffort) opts.reasoningEffort = sel.reasoningEffort;
		let text = "";
		let failure = null;
		try {
			for await (const ch of ctx.llm.stream(opts)) if (ch.type === "text-delta") text += ch.text;
			else if (ch.type === "finish" && (ch.reason.kind === "error" || ch.reason.kind === "aborted")) failure = ch.reason.failure && ch.reason.failure.message || ch.reason.kind;
		} catch (err) {
			failure = String(err && err.message || err);
		}
		if (failure) throw new Error("模型调用失败: " + failure);
		return text;
	}
	function extractJson(text) {
		const s = String(text || "");
		const start = s.indexOf("{");
		if (start < 0) return null;
		let depth = 0, inStr = false, esc = false;
		for (let i = start; i < s.length; i++) {
			const ch = s[i];
			if (inStr) {
				if (esc) esc = false;
				else if (ch === "\\") esc = true;
				else if (ch === "\"") inStr = false;
				continue;
			}
			if (ch === "\"") inStr = true;
			else if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) try {
					return JSON.parse(s.slice(start, i + 1));
				} catch (_) {
					return null;
				}
			}
		}
		return null;
	}
	function extractJsonArr(text) {
		const s = String(text || "");
		const start = s.indexOf("[");
		if (start < 0) return null;
		let depth = 0, inStr = false, esc = false;
		for (let i = start; i < s.length; i++) {
			const ch = s[i];
			if (inStr) {
				if (esc) esc = false;
				else if (ch === "\\") esc = true;
				else if (ch === "\"") inStr = false;
				continue;
			}
			if (ch === "\"") inStr = true;
			else if (ch === "[") depth++;
			else if (ch === "]") {
				depth--;
				if (depth === 0) try {
					return JSON.parse(s.slice(start, i + 1));
				} catch (_) {
					return null;
				}
			}
		}
		return null;
	}
	function errMsg(e) {
		const m = String(e && e.message || e || "");
		const code = e && e.cause && e.cause.code || "";
		return code ? m + " (" + code + ")" : m;
	}
	async function fetchContentImpl(url, opts) {
		if (opts && opts.viaBrowser) try {
			return await fetchViaBrowser(String(url));
		} catch (err) {
			throw new Error("浏览器抓取失败 " + String(url) + "（" + errMsg(err) + "）");
		}
		const reasons = [];
		if (typeof process !== "undefined" && process.env && (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)) {
			try {
				return await fetchViaCurl(String(url));
			} catch (err) {
				reasons.push("curl: " + errMsg(err));
			}
			throw new Error("抓取失败 " + String(url) + "（" + reasons.join("；") + "）");
		}
		try {
			const r = await ctx.web.fetch({ url: String(url) });
			return {
				url: r.url,
				statusCode: r.statusCode,
				body: r.body,
				truncated: !!r.truncated
			};
		} catch (err) {
			reasons.push("web.fetch: " + errMsg(err));
		}
		try {
			return await fetchViaNode(String(url));
		} catch (err) {
			reasons.push("node fetch: " + errMsg(err));
		}
		try {
			return await fetchViaCurl(String(url));
		} catch (err) {
			reasons.push("curl: " + errMsg(err));
		}
		throw new Error("抓取失败 " + String(url) + "（" + reasons.join("；") + "）");
	}
	async function fetchViaNode(url) {
		if (typeof fetch !== "function") throw new Error("Node fetch 不可用");
		let lastErr = null;
		for (let attempt = 1; attempt <= 2; attempt++) try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(2e4),
				headers: { "user-agent": "Mozilla/5.0 (compatible; dsh-livefeed/1.0)" }
			});
			let text = await res.text();
			let truncated = false;
			if (text.length > 12e5) {
				text = text.slice(0, 12e5);
				truncated = true;
			}
			const lower = text.slice(0, 2e3).toLowerCase();
			const kind = /<html|<head|<body/i.test(lower) ? "html" : "text";
			return {
				url: String(url),
				statusCode: res.status,
				body: {
					kind,
					content: text
				},
				truncated
			};
		} catch (err) {
			lastErr = err;
			const code = err && err.cause && err.cause.code || "";
			log.warn("[dsh-livefeed] node fetch attempt " + attempt + "/2 failed:", String(url), code || String(err && err.message || err));
		}
		const code = lastErr && lastErr.cause && lastErr.cause.code || "";
		throw new Error(code ? code + "（直连失败，请检查网络/代理）" : String(lastErr && lastErr.message || lastErr));
	}
	async function fetchViaCurl(url) {
		const shell = ctx.get("shell");
		if (shell === void 0) throw new Error("web.fetch 与 shell 均不可用");
		const safeUrl = String(url).replace(/"/g, "%22");
		const spec = shell.resolve({
			command: "curl.exe -sL --max-time 20 --compressed -A \"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36\" \"" + safeUrl + "\"",
			timeoutMs: 3e4,
			stdoutMaxBytes: 12e5,
			sandboxPolicy: {
				mode: "danger-full-access",
				workspaceRoot: typeof process !== "undefined" && process.cwd && process.cwd() || CONFIG_DIR
			}
		});
		const res = await shell.run(spec);
		if (res.exitCode !== 0) {
			const stderr = (res.stderr && res.stderr.text || "").slice(0, 300);
			throw new Error("curl 失败 exit=" + res.exitCode + (stderr ? " (" + stderr.trim() + ")" : ""));
		}
		const text = res.stdout && res.stdout.text || "";
		if (!text) throw new Error("curl 返回空内容");
		const lower = text.slice(0, 2e3).toLowerCase();
		const kind = /<html|<head|<body/i.test(lower) ? "html" : "text";
		return {
			url: String(url),
			statusCode: 200,
			body: {
				kind,
				content: text
			},
			truncated: !!(res.stdout && res.stdout.truncated)
		};
	}
	const BROWSER_PROFILE_DIR = CONFIG_DIR + "/edge-profile";
	const BROWSER_IDLE_MS = 90 * 1e3;
	const browserSession = {
		ctx: null,
		page: null,
		starting: null,
		idleStop: null
	};
	function browserLog(...a) {
		log.info("[dsh-livefeed][browser]", ...a);
	}
	async function closeBrowserSession() {
		const s = browserSession;
		if (s.idleStop) {
			try {
				s.idleStop();
			} catch (_) {}
			s.idleStop = null;
		}
		const c = s.ctx;
		s.ctx = null;
		s.page = null;
		s.starting = null;
		if (c) try {
			await c.close();
		} catch (_) {}
	}
	function touchBrowserSession() {
		const s = browserSession;
		if (s.idleStop) {
			try {
				s.idleStop();
			} catch (_) {}
			s.idleStop = null;
		}
		if (!s.ctx) return;
		s.idleStop = ctx.timeout(async () => {
			s.idleStop = null;
			if (s.ctx) {
				browserLog("idle close");
				await closeBrowserSession();
			}
		}, BROWSER_IDLE_MS);
	}
	async function getBrowserPage() {
		const s = browserSession;
		if (s.page && !s.page.isClosed()) {
			touchBrowserSession();
			return s.page;
		}
		await closeBrowserSession();
		if (s.starting) return s.starting;
		s.starting = (async () => {
			let pw = null;
			try {
				pw = await import("playwright-core");
			} catch (_) {
				throw new Error("playwright-core 未安装（git 安装会自动携带依赖）");
			}
			let lastErr = null;
			for (const channel of ["msedge", "chrome"]) try {
				const c = await pw.chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
					channel,
					headless: false,
					args: [
						"--no-first-run",
						"--disable-gpu",
						"--window-position=-32000,-32000",
						"--window-size=1280,800"
					],
					viewport: {
						width: 1280,
						height: 800
					},
					locale: "zh-CN"
				});
				s.ctx = c;
				s.page = c.pages()[0] || await c.newPage();
				browserLog("launched channel=" + channel);
				touchBrowserSession();
				return s.page;
			} catch (err) {
				lastErr = err;
			}
			throw new Error("浏览器启动失败（msedge/chrome）：" + String(lastErr && lastErr.message || lastErr).split("\n")[0]);
		})().finally(() => {
			s.starting = null;
		});
		return s.starting;
	}
	async function resetBrowserProfile() {
		await closeBrowserSession();
		await new Promise((r) => {
			try {
				ctx.timeout(r, 1500);
			} catch (_) {
				r();
			}
		});
		const shell = ctx.get("shell");
		if (shell === void 0) {
			browserLog("shell 不可用，无法重置档案");
			return;
		}
		try {
			const spec = shell.resolve({
				command: "cmd /c if exist \"" + BROWSER_PROFILE_DIR + "\" rd /s /q \"" + BROWSER_PROFILE_DIR + "\"",
				timeoutMs: 3e4,
				stdoutMaxBytes: 1e4,
				sandboxPolicy: { mode: "danger-full-access" }
			});
			await shell.run(spec);
			browserLog("档案已重置（下次启动自动重建全新 Edge profile）");
		} catch (err) {
			log.error("[dsh-livefeed] 档案重置失败:", String(err && err.message || err));
		}
	}
	async function fetchViaBrowser(url) {
		let page;
		try {
			page = await getBrowserPage();
		} catch (err) {
			await closeBrowserSession();
			page = await getBrowserPage();
		}
		touchBrowserSession();
		const chalText = (s) => s.indexOf("请稍候") >= 0 || s.indexOf("Just a moment") >= 0 || s.indexOf("cf-chl") >= 0;
		const readState = async () => ({
			text: await page.evaluate(() => document.body && document.body.innerText || "").catch(() => ""),
			title: await page.title().catch(() => "")
		});
		const docResponses = [];
		let hookedPage = null;
		const onResp = (r) => {
			try {
				if (r.request().resourceType() !== "document") return;
				const entry = {
					status: r.status(),
					url: r.url(),
					body: "",
					done: false
				};
				docResponses.push(entry);
				if (docResponses.length > 40) docResponses.shift();
				r.text().then((txt) => {
					entry.body = txt || "";
					entry.done = true;
				}).catch(() => {
					entry.done = true;
				});
			} catch (_) {}
		};
		const ensureHook = (pageObj) => {
			if (hookedPage === pageObj) return;
			hookedPage = pageObj;
			pageObj.on("response", onResp);
		};
		ensureHook(page);
		const trySolveTurnstile = async () => {
			for (const fr of page.frames()) try {
				if (await fr.evaluate(() => {
					const el = Array.from(document.querySelectorAll("input[type=checkbox], .ctp-checkbox, button")).find((e) => {
						if (e.tagName === "INPUT") return true;
						const tx = String(e.textContent || e.ariaLabel || e.title || "").toLowerCase();
						return /verify|human|验证/.test(tx);
					});
					if (el) {
						el.click();
						return true;
					}
					return false;
				}).catch(() => false)) {
					browserLog("Turnstile 复选框已点击");
					return true;
				}
			} catch (_) {}
			return false;
		};
		const waitChallenge = async () => {
			let st = await readState();
			for (let i = 0; i < 15 && (chalText(st.text) || chalText(st.title)); i++) {
				await page.waitForTimeout(5e3).catch(() => {});
				if (i === 2) {
					browserLog("CF 质询中… reload #1");
					try {
						await page.reload({ timeout: 3e4 });
					} catch (_) {}
				}
				if (i === 6) await trySolveTurnstile();
				if (i === 10) {
					browserLog("CF 质询仍未通过… reload #2");
					try {
						await page.reload({ timeout: 3e4 });
					} catch (_) {}
				}
				st = await readState();
			}
			return chalText(st.text) || chalText(st.title);
		};
		const sessionDead = (err) => /closed|crash|target|context|disconnect|protocol|ebmlastchance/i.test(String(err && err.message || err));
		const waitBody = async () => {
			for (let i = 0; i < 25; i++) {
				const last = docResponses[docResponses.length - 1];
				if (last === void 0 || last.done) return;
				await page.waitForTimeout(200).catch(() => {});
			}
		};
		for (let attempt = 0; attempt < 2; attempt++) try {
			docResponses.length = 0;
			let navErr = null;
			await page.goto(String(url), {
				waitUntil: "domcontentloaded",
				timeout: 45e3
			}).catch((e) => {
				navErr = e;
			});
			let st = await readState();
			let lastDoc = docResponses[docResponses.length - 1] || null;
			const rateLimited = lastDoc !== null && (lastDoc.status === 429 || lastDoc.status === 403 || lastDoc.status === 503);
			if (chalText(st.text) || chalText(st.title) || rateLimited) {
				browserLog("CF 质询/限流检测到（HTTP " + (lastDoc ? lastDoc.status : "?") + "），等待自动通过（最多 ~75s）…");
				if (await waitChallenge()) {
					browserLog("CF 质询未通过（保留档案，限流需等待更久）: " + String(url));
					break;
				}
				st = await readState();
				await waitBody();
			}
			let t = "";
			for (const e of [...docResponses].reverse()) {
				if (!e.done || !e.body || !e.body.trim()) continue;
				const body = e.body.trim();
				const lower = body.slice(0, 2e3).toLowerCase();
				if (/<(!doctype|html|head|body)/i.test(lower)) {
					if (chalText(body) || e.status === 429 || e.status === 403 || e.status === 503) continue;
					t = body;
				} else t = body;
				break;
			}
			if (!t) try {
				const js = await page.evaluate(async (u) => {
					try {
						const r = await fetch(u, { headers: { accept: "application/json, text/plain, */*" } });
						const txt = await r.text();
						return {
							status: r.status,
							txt
						};
					} catch (err) {
						return {
							status: 0,
							txt: "",
							err: String(err && err.message || err)
						};
					}
				}, String(url));
				if (js && js.txt && js.txt.trim()) {
					const lower = js.txt.slice(0, 2e3).toLowerCase();
					if (/<(!doctype|html|head|body)/i.test(lower)) if (chalText(js.txt) || js.status === 429 || js.status === 403 || js.status === 503) {
						browserLog("in-page fetch 返回质询/限流页 status=" + js.status);
						if (await waitChallenge()) break;
					} else t = js.txt.trim();
					else t = js.txt.trim();
				} else if (js && js.status) browserLog("in-page fetch 空响应 status=" + js.status + (js.err ? " err=" + js.err : ""));
			} catch (err) {
				browserLog("in-page fetch 失败，回退 innerText: " + String(err && err.message || err));
			}
			if (!t) {
				t = String(st.text || "").trim();
				if (t && t[0] !== "{" && t[0] !== "[") {
					const m = (await page.content().catch(() => "")).match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
					if (m) t = m[1].trim();
				}
			}
			if (!t) {
				const last2 = docResponses[docResponses.length - 1];
				if (last2 && (last2.status === 429 || last2.status === 403 || last2.status === 503)) throw new Error("浏览器抓取被限流（HTTP " + last2.status + "），建议等待 10~30 分钟或更换网络后再试");
				if (docResponses.length === 0) throw new Error("浏览器无法建立连接（" + (navErr && navErr.message ? String(navErr.message).split("\n")[0] : "网络错误") + "）—— 请检查网络/VPN/代理后再试");
				throw new Error("浏览器抓取内容为空");
			}
			let truncated = false;
			if (t.length > 12e5) {
				t = t.slice(0, 12e5);
				truncated = true;
			}
			return {
				url: String(url),
				statusCode: 200,
				body: {
					kind: "text",
					content: t
				},
				truncated
			};
		} catch (err) {
			if (attempt === 1) throw err;
			const dead = sessionDead(err);
			browserLog((dead ? "浏览器会话失效，重置档案后重试" : "抓取异常（保留档案），3s 后重试") + ": " + String(err && err.message || err).split("\n")[0]);
			if (dead) {
				await resetBrowserProfile();
				page = await getBrowserPage();
				ensureHook(page);
			} else await new Promise((r) => {
				try {
					ctx.timeout(r, 3e3);
				} catch (_) {
					r();
				}
			});
			touchBrowserSession();
		}
		throw new Error("CF 质询未通过（Cloudflare 校验持续，多与代理节点/IP 信誉有关，网站本身正常）；浏览器档案已保留，将自动重试: " + String(url));
	}
	function buildProgram(template, script) {
		return template + "\n" + (script || "");
	}
	async function loadTemplateAndScript(source) {
		let template = BUILTIN_TEMPLATE;
		const custom = await fsRead(TEMPLATE_FILE);
		if (custom && custom.indexOf("_dshLivefeedDispatcher") >= 0) template = custom;
		else if (custom) log.error("[dsh-livefeed] sources/_template.js 缺少调度器标记，回退内置模板");
		if (!template) throw new Error("基类模板缺失：请确认运行目录存在 sources/_template.js");
		let script = "";
		if (source && source.script) {
			const sp = await fsRead(CONFIG_DIR + "/" + String(source.script));
			if (sp === null) throw new Error("源脚本不存在: " + source.script);
			script = sp;
		}
		return buildProgram(template, script);
	}
	async function runSourceScript(program, args) {
		const codeRuntime = ctx.get("codeRuntime");
		if (codeRuntime === void 0) throw new Error("codeRuntime 服务不可用：无法执行源脚本");
		const run = await codeRuntime.run({
			program,
			bindings: [{
				global: "api",
				functions: {
					mode: async () => args.mode,
					config: async () => args.config || {},
					item: async () => args.item || null,
					search: async (a) => {
						const req = a || {};
						return ctx.web.search({
							query: String(req.query || ""),
							maxResults: req.maxResults
						});
					},
					fetchContent: async (a) => fetchContentImpl((a || {}).url, { viaBrowser: !!(args.config && args.config.fetch === "browser") }),
					seenUrls: async () => Array.from(state.seenUrls)
				}
			}]
		});
		if (run.error) throw new Error("脚本执行失败: " + run.error.message);
		return run.value;
	}
	async function stageCoarse(source) {
		const program = await loadTemplateAndScript(source);
		const cap = Math.max(1, Number(state.config.fetchCount) || DEFAULT_FETCH_COUNT);
		const items = await runSourceScript(program, {
			mode: "titles",
			config: Object.assign({}, source, {
				maxItems: cap,
				blockTags: BLOCK_TAGS
			})
		});
		return Array.isArray(items) ? items : [];
	}
	function isBlockedTopic(it) {
		const title = String(it && it.title || "");
		const tags = Array.isArray(it && it.tags) ? it.tags.map(String) : [];
		return BLOCK_TAGS.some((t) => tags.indexOf(t) >= 0 || title.indexOf(t) >= 0);
	}
	async function pullFresh(items) {
		const cap = Math.max(1, Number(state.config.fetchCount) || DEFAULT_FETCH_COUNT);
		const out = [];
		for (const it of items) {
			if (out.length >= cap) break;
			const key = normalizeUrl(it && it.url);
			if (!key || state.seenUrls.has(key)) continue;
			if (isBlockedTopic(it)) continue;
			out.push(it);
		}
		return out;
	}
	function valueScore(it) {
		const r = Number(it.replyCount) || 0;
		const v = Number(it.views) || 0;
		const l = Number(it.likes) || 0;
		return r * 4 + v / 60 + l * 2;
	}
	async function stageJudge(items) {
		const cap = Math.max(1, Number(state.config.outputCount) || DEFAULT_OUTPUT_COUNT);
		if (!items.length) return [];
		if (items.length <= cap) return items;
		const list = items.map((it, i) => ({
			i,
			title: String(it.title || ""),
			url: String(it.url || ""),
			snippet: String(it.snippet || "").slice(0, 200),
			replyCount: Number(it.replyCount) || 0,
			views: Number(it.views) || 0,
			likes: Number(it.likes) || 0,
			tags: Array.isArray(it.tags) ? it.tags.map(String) : []
		}));
		const system = "你是话题价值筛选助手。以下是 Linux Do 论坛新拉取的话题列表，请按「价值」选出最有价值的 N 条。判断价值时综合考量：回复数与讨论热度（回复越多通常越有价值）、浏览量/点赞数（受关注程度）、话题内容是否有质量（是否具体、信息量足、对读者有实际帮助）、时效性与新鲜度，并避开垃圾/纯推广/无实质内容的话题——纯广告/福利推广类帖子即使回复数很高也不算价值。注意：不要根据话题的主题、标题关键词或标签过滤——任何主题的话题都可能是高价值的；只判断话题本身的价值。输出条数应尽量接近 N（列表长度足够时恰好输出 N 条），并按价值从高到低排序。\nN = " + cap + "\n只输出 JSON: {\"selected\":[{\"index\":0,\"reason\":\"一句话理由\"}]}。";
		let parsed = null;
		const budgets = [
			4e3,
			6e3,
			8e3
		];
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				parsed = extractJson(await callModel(system, JSON.stringify(list, null, 1), budgets[attempt - 1]));
				if (parsed && Array.isArray(parsed.selected)) break;
			} catch (err) {
				log.warn("[dsh-livefeed] judge call failed:", String(err && err.message || err));
			}
			if (attempt < 3) log.warn("[dsh-livefeed] judge parse failed, retry", attempt + "/3");
		}
		const picked = [];
		const used = /* @__PURE__ */ new Set();
		if (parsed && Array.isArray(parsed.selected)) for (const s of parsed.selected) {
			const idx = Number(s && s.index);
			if (Number.isInteger(idx) && idx >= 0 && idx < items.length && !used.has(idx)) {
				used.add(idx);
				picked.push(items[idx]);
			}
			if (picked.length >= cap) break;
		}
		if (picked.length < cap) {
			const rest = items.map((it, i) => ({
				it,
				i,
				s: valueScore(it)
			})).filter((x) => !used.has(x.i)).sort((a, b) => b.s - a.s);
			for (const x of rest) {
				if (picked.length >= cap) break;
				picked.push(x.it);
			}
		}
		return picked;
	}
	function isBlockPage(text) {
		const t = String(text || "").toLowerCase();
		for (const m of [
			"attention required",
			"checking your browser",
			"verify you are human",
			"enable javascript and cookies",
			"just a moment",
			"access denied",
			"you have been blocked",
			"cf-chl",
			"captcha",
			"puzzle",
			"your current connection has been blocked",
			"we have detected unusual activity",
			"异常活动",
			"安全系统阻止",
			"检测到异常",
			"安全验证"
		]) if (t.indexOf(m) >= 0) return true;
		const weak = [
			"cloudflare",
			"akamai",
			"security check",
			"bot",
			"challenge",
			"reference number",
			"permission",
			"blocked",
			"被阻止",
			"安全系统"
		];
		let w = 0;
		if (t.length < 12e3) {
			for (const m of weak) if (t.indexOf(m) >= 0) w++;
		}
		return w >= 2;
	}
	const SUMMARIZE_INPUT_BUDGET = 3e4;
	async function fetchItemContent(item, source) {
		let content = null;
		try {
			const out = await runSourceScript(await loadTemplateAndScript(source), {
				mode: "content",
				config: source,
				item
			});
			if (out && out.text) if (isBlockPage(out.text)) {
				log.info("[dsh-livefeed] block-page content skipped:", item.url);
				content = null;
			} else content = out.text;
		} catch (err) {
			log.error("[dsh-livefeed] fineSearch failed:", String(err && err.message || err));
		}
		const snippet = String(item.snippet || "");
		return {
			item,
			source,
			content,
			fallbackText: content || snippet,
			sourceText: (content || snippet).slice(0, 6e3)
		};
	}
	async function stageSummarize(entries) {
		const lang = state.config.summaryLanguage || "zh-CN";
		const cards = [];
		if (!entries.length) return cards;
		const sourceName = entries[0].source && entries[0].source.name || "Linux Do";
		state.progress = {
			stage: "fine",
			detail: sourceName,
			ts: Date.now()
		};
		const perItem = Math.max(800, Math.min(6e3, Math.floor(SUMMARIZE_INPUT_BUDGET / entries.length)));
		const results = new Array(entries.length).fill(null);
		try {
			const parsed = extractJsonArr(await callModel("你是资讯摘要助手。以下内容来自「" + sourceName + "」。对每条内容生成「" + lang + "」标题与 2-3 句摘要。标题必须翻译成「" + lang + "」（专有名词/产品名/品牌名可保留原文）。只输出 JSON 数组，顺序对应输入，每条都必须包含 index/title/summary：[{\"index\":0,\"title\":\"…\",\"summary\":\"…\"}]", JSON.stringify(entries.map((e, i) => ({
				index: i,
				title: e.item.title,
				content: e.sourceText.slice(0, perItem)
			}))), Math.min(12e3, 2e3 + entries.length * 400)));
			if (Array.isArray(parsed)) for (const p of parsed) {
				if (!p || typeof p.index !== "number" || !Number.isInteger(p.index) || p.index < 0 || p.index >= entries.length) continue;
				if (p.title && p.summary) results[p.index] = {
					title: String(p.title),
					summary: String(p.summary)
				};
			}
		} catch (err) {
			log.error("[dsh-livefeed] summarize failed:", String(err && err.message || err));
		}
		for (let i = 0; i < entries.length; i++) {
			const e = entries[i];
			const r = results[i];
			cards.push({
				title: r ? r.title : e.item.title,
				summary: r ? r.summary : e.fallbackText ? e.fallbackText.slice(0, 300) : "（正文抓取失败，点击卡片查看原文）",
				url: e.item.url,
				sourceName: e.source.name,
				publishedAt: e.item.publishedAt
			});
		}
		return cards;
	}
	async function stageLand(cards) {
		const newCards = [];
		for (const card of cards) {
			if (!card || !card.url) continue;
			const key = normalizeUrl(card.url);
			if (state.seenUrls.has(key)) continue;
			state.seenUrls.add(key);
			const full = {
				id: "c" + state.tick + "-" + newCards.length + "-" + Math.random().toString(36).slice(2, 8),
				title: card.title,
				summary: card.summary,
				url: card.url,
				sourceName: card.sourceName || "",
				publishedAt: card.publishedAt,
				read: false,
				isNew: true,
				createdAt: Date.now(),
				cycle: state.cycleStamp || null
			};
			newCards.push(full);
			state.cards.push(full);
		}
		const bound = cardBound();
		if (state.cards.length > bound) {
			const removable = state.cards.filter((c) => c.read);
			let over = state.cards.length - bound;
			for (const rc of removable) {
				if (over <= 0) break;
				const idx = state.cards.indexOf(rc);
				if (idx >= 0) {
					state.cards.splice(idx, 1);
					over--;
				}
			}
			if (state.cards.length > bound) state.cards.splice(0, state.cards.length - bound);
		}
		for (const c of newCards) state.archive.push({
			id: c.id,
			title: c.title,
			url: c.url,
			summary: c.summary,
			sourceName: c.sourceName,
			publishedAt: c.publishedAt,
			createdAt: c.createdAt
		});
		await saveArchive();
		return newCards;
	}
	async function saveState() {
		await fsWrite(STATE_FILE, JSON.stringify({
			cards: state.cards.slice(-cardBound()),
			lastRunAt: state.lastRunAt
		}, null, 2));
	}
	async function saveConfig() {
		await fsWrite(CONFIG_FILE, JSON.stringify(state.config, null, 2));
	}
	async function saveArchive() {
		if (state.archive.length > 5e3) state.archive = state.archive.slice(-5e3);
		await fsWrite(HISTORY_FILE, state.archive.map((x) => JSON.stringify(x)).join("\n"));
	}
	function cardBound() {
		return Math.max(20, Math.min(2e3, Number(state.config && state.config.maxCards) || DEFAULT_MAX_CARDS));
	}
	function retentionMs() {
		const d = Number(state.config && state.config.retentionDays) || DEFAULT_RETENTION_DAYS;
		return Math.max(1, d) * 24 * 60 * 60 * 1e3;
	}
	function purgeExpiredCards() {
		const cutoff = Date.now() - retentionMs();
		const before = state.cards.length;
		state.cards = state.cards.filter((c) => {
			if (!c.read) return true;
			return (Number(c.readAt || c.createdAt) || 0) >= cutoff;
		});
		const purged = before - state.cards.length;
		if (purged > 0) log.info("[dsh-livefeed] 清除过期已读卡片 " + purged + " 条（保留 " + state.config.retentionDays + " 天）");
	}
	async function loadAll() {
		const cfgText = await fsRead(CONFIG_FILE);
		state.config = mergeConfig(defaultConfig(), parseJson(cfgText, null));
		const st = parseJson(await fsRead(STATE_FILE), null);
		state.cards = (st && Array.isArray(st.cards) ? st.cards : []).filter((c) => c && c.url).slice(-cardBound()).map((c) => Object.assign({
			isNew: false,
			createdAt: Date.now()
		}, c, { isNew: false }));
		purgeExpiredCards();
		if (st && typeof st.lastRunAt === "number" && Number.isFinite(st.lastRunAt)) state.lastRunAt = Math.min(st.lastRunAt, Date.now());
		state.archive = [];
		state.seenUrls = /* @__PURE__ */ new Set();
		const histText = await fsRead(HISTORY_FILE);
		if (histText) for (const line of histText.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			const item = parseJson(t, null);
			if (!item || !item.url) continue;
			state.archive.push(item);
			state.seenUrls.add(normalizeUrl(item.url));
		}
		for (const c of state.cards) state.seenUrls.add(normalizeUrl(c.url));
	}
	async function runCycle() {
		if (disposed || state.running) return;
		if (state.paused) return;
		state.running = true;
		state.sourceErrors = [];
		state.cycleStats = null;
		state.cycleStamp = Date.now();
		try {
			await loadAll();
			const stats = {
				scanned: 0,
				selected: 0,
				filtered: 0
			};
			const source = linuxdoSource(state.config);
			let failed = false;
			if (!source || source.enabled === false) {
				state.lastError = "Linux Do 源已禁用（config.json）";
				state.cycleStats = stats;
			} else {
				try {
					state.progress = {
						stage: "coarse",
						detail: String(source.name || source.id || ""),
						ts: Date.now()
					};
					const items = await stageCoarse(source);
					stats.scanned = items.length;
					state.progress = {
						stage: "judge",
						detail: String(source.name || source.id || ""),
						ts: Date.now()
					};
					const picked = await stageJudge(await pullFresh(items));
					let landed = 0;
					if (picked.length) {
						const entries = [];
						for (const it of picked) {
							state.progress = {
								stage: "fine",
								detail: String(source.name || source.id || ""),
								ts: Date.now()
							};
							const e = await fetchItemContent(it, source);
							if (e) entries.push(e);
						}
						if (entries.length) {
							const cards = await stageSummarize(entries);
							state.progress = {
								stage: "land",
								detail: "",
								ts: Date.now()
							};
							landed = (await stageLand(cards)).length;
						}
					}
					stats.selected = landed || picked.length;
					stats.filtered = stats.scanned - stats.selected;
				} catch (err) {
					failed = true;
					state.sourceErrors.push({
						sourceId: String(source.id || ""),
						message: String(err && err.message || err)
					});
					state.lastError = String(err && err.message || err);
					log.error("[dsh-livefeed] source failed:", source.id, err);
				}
				state.cycleStats = stats;
				if (!failed) {
					state.lastError = void 0;
					state.retrying = 0;
				}
				state.tick += 1;
			}
			state.lastRunAt = Date.now();
			await saveState();
			if (failed) scheduleRetry();
		} catch (err) {
			state.lastError = String(err && err.message || err);
			log.error("[dsh-livefeed] cycle failed:", err);
			state.lastRunAt = Date.now();
			await saveState();
			scheduleRetry();
		} finally {
			state.running = false;
			state.progress = null;
		}
	}
	function scheduleRetry() {
		if (disposed || state.paused) return;
		if (state.retrying >= RETRY_MAX) {
			state.retrying = 0;
			return;
		}
		state.retrying += 1;
		const delay = RETRY_BASE_MS * Math.pow(2, state.retrying - 1);
		log.info("[dsh-livefeed] schedule retry", state.retrying, "delay ms", delay);
		ctx.timeout(() => {
			if (!disposed) runCycle();
		}, delay);
	}
	function intervalMs() {
		const m = Number(state.config && state.config.intervalMinutes) || DEFAULT_INTERVAL_MIN;
		return Math.max(1, m) * 60 * 1e3;
	}
	function tick() {
		if (disposed || state.paused || state.running) return;
		if (state.lastRunAt !== void 0 && Date.now() - state.lastRunAt < intervalMs()) return;
		runCycle();
	}
	const handlers = {
		"cards": async () => jsonSafe({
			cards: state.cards.slice(-cardBound()).map((c) => ({
				id: c.id,
				title: c.title,
				summary: c.summary,
				url: c.url,
				sourceName: c.sourceName,
				publishedAt: c.publishedAt,
				isNew: !!c.isNew,
				read: !!c.read,
				createdAt: c.createdAt,
				cycle: c.cycle === void 0 || c.cycle === null ? null : c.cycle
			})),
			status: {
				running: state.running,
				paused: state.paused,
				retrying: state.retrying,
				lastRunAt: state.lastRunAt,
				lastError: state.lastError,
				sourceErrors: state.sourceErrors,
				cycleStats: state.cycleStats,
				progress: state.progress,
				tick: state.tick
			}
		}),
		"config": async () => jsonSafe({ config: state.config ? {
			intervalMinutes: state.config.intervalMinutes,
			fetchCount: state.config.fetchCount,
			outputCount: state.config.outputCount,
			retentionDays: state.config.retentionDays,
			maxCards: state.config.maxCards,
			summaryLanguage: state.config.summaryLanguage,
			model: state.config.model || null
		} : null }),
		"refresh": async () => {
			if (state.paused) return {
				accepted: false,
				reason: "paused"
			};
			if (state.running) return {
				accepted: false,
				reason: "running"
			};
			runCycle();
			return { accepted: true };
		},
		"mark": async (args) => {
			const a = args || {};
			const card = state.cards.find((c) => c.id === a.cardId);
			if (card && a.read === true) {
				card.read = true;
				card.readAt = Date.now();
				card.isNew = false;
				await saveState();
			}
			return { ok: true };
		},
		"mark-all-read": async () => {
			let changed = false;
			const now = Date.now();
			for (const c of state.cards) if (!c.read) {
				c.read = true;
				c.readAt = now;
				c.isNew = false;
				changed = true;
			}
			if (changed) await saveState();
			return { ok: true };
		},
		"mark-cycle-read": async (args) => {
			const cycle = Number((args || {}).cycle);
			let changed = 0;
			if (Number.isFinite(cycle)) {
				const now = Date.now();
				for (const c of state.cards) if (!c.read && Number(c.cycle) === cycle) {
					c.read = true;
					c.readAt = now;
					c.isNew = false;
					changed += 1;
				}
			}
			if (changed > 0) await saveState();
			return {
				ok: true,
				changed
			};
		},
		"set-paused": async (args) => {
			state.paused = !!(args && args.paused);
			return {
				ok: true,
				paused: state.paused
			};
		},
		"update-settings": async (args) => {
			const a = args || {};
			const cfg = state.config || defaultConfig();
			if (typeof a.intervalMinutes === "number" && a.intervalMinutes >= 1 && a.intervalMinutes <= 1440) cfg.intervalMinutes = Math.round(a.intervalMinutes);
			if (typeof a.fetchCount === "number" && a.fetchCount >= 1 && a.fetchCount <= 200) cfg.fetchCount = Math.round(a.fetchCount);
			if (typeof a.outputCount === "number" && a.outputCount >= 1 && a.outputCount <= 50) cfg.outputCount = Math.round(a.outputCount);
			if (typeof a.retentionDays === "number" && a.retentionDays >= 1 && a.retentionDays <= 90) cfg.retentionDays = Math.round(a.retentionDays);
			if (typeof a.maxCards === "number" && a.maxCards >= 20 && a.maxCards <= 2e3) cfg.maxCards = Math.round(a.maxCards);
			state.config = cfg;
			await saveConfig();
			return { ok: true };
		}
	};
	function readBody(req) {
		return new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on("data", (chunk) => {
				size += chunk.length;
				if (size > 1024 * 1024) {
					reject(/* @__PURE__ */ new Error("payload too large"));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}
	const requestLog = [];
	function logRequest(req, method, ok, info) {
		requestLog.push({
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			httpMethod: req.method,
			url: String(req.url || ""),
			method,
			ok: !!ok,
			info: String(info || "")
		});
		if (requestLog.length > 200) requestLog.splice(0, requestLog.length - 200);
	}
	ctx.effect(() => {
		log.info("[dsh-livefeed] config dir:", CONFIG_DIR);
		loadAll();
		const stopRoute = ctx.webServer.register({
			kind: "exact",
			path: ROUTE_PATH,
			handler: async (req, res) => {
				const send = (status, payload) => {
					res.writeHead(status, {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store"
					});
					res.end(JSON.stringify(jsonSafe(payload)));
				};
				let payload = {};
				if (req.method === "POST") try {
					payload = JSON.parse(await readBody(req)) || {};
				} catch (_) {
					payload = {};
				}
				else if (req.method === "GET" || req.method === "HEAD") try {
					const u = new URL(req.url || "/", "http://local");
					payload = {
						method: String(u.searchParams.get("method") || ""),
						args: {}
					};
				} catch (_) {
					payload = {};
				}
				const method = String(payload.method || "");
				const handler = handlers[method];
				if (!handler) {
					logRequest(req, method, false, "unknown method");
					send(404, {
						ok: false,
						error: "unknown method: " + method
					});
					return;
				}
				try {
					const data = await handler(payload.args || {});
					logRequest(req, method, true, "ok");
					send(200, {
						ok: true,
						data
					});
				} catch (err) {
					logRequest(req, method, false, String(err && err.message || err));
					send(500, {
						ok: false,
						error: String(err && err.message || err)
					});
				}
			}
		});
		let stopHarness = null;
		if (typeof harness !== "undefined") {
			const disposers = Object.keys(handlers).map((m) => harness.handle("dsh-livefeed/" + m, (args) => handlers[m](args)));
			stopHarness = () => disposers.forEach((d) => {
				try {
					d();
				} catch (_) {}
			});
		}
		const stopInterval = ctx.interval(tick, TICK_MS);
		const stopBoot = ctx.timeout(() => {
			if (disposed || state.paused) return;
			if (state.lastRunAt !== void 0 && Date.now() - state.lastRunAt < intervalMs()) {
				log.info("[dsh-livefeed] 距上次采集不足间隔，跳过启动采集（上次: " + new Date(state.lastRunAt).toISOString() + "，间隔: " + intervalMs() + "ms）");
				return;
			}
			runCycle();
		}, 15 * 1e3);
		return () => {
			disposed = true;
			if (stopRoute) stopRoute();
			if (stopHarness) stopHarness();
			if (stopInterval) stopInterval();
			if (stopBoot) stopBoot();
			closeBrowserSession();
		};
	});
}
//#endregion
//#region src/index.mjs
const name = "dsh-notes";
const inject = [
	"webServer",
	"timer",
	"web",
	"llm",
	"fs",
	"agentDefaultModel"
];
const TODO_TEXT_MAX = 500;
const DETAIL_MAX = 2e4;
const MEMO_MAX = 2e4;
const ROUTE_PATH = "/api/dsh-notes";
const UNDO_CAP = 100;
const passthroughSchema = {
	parse(value) {
		if (value === null) throw new Error("null not allowed");
		return value;
	},
	safeParse(value) {
		return value === null ? { success: false } : {
			success: true,
			data: value
		};
	}
};
const notesDomainSpec = {
	name: "notes",
	version: 1,
	global: {
		schema: passthroughSchema,
		initial: {
			todos: [],
			memo: ""
		}
	},
	tables: { workspaces: { valueSchema: passthroughSchema } }
};
function copyScope(scope) {
	return {
		todos: scope.todos.map((item) => ({
			id: item.id,
			text: item.text,
			done: item.done,
			pinned: item.pinned === true,
			detail: typeof item.detail === "string" ? item.detail : "",
			createdAt: item.createdAt,
			updatedAt: item.updatedAt
		})),
		memo: scope.memo
	};
}
function emptyScope() {
	return {
		todos: [],
		memo: ""
	};
}
function openCount(todos) {
	let count = 0;
	for (const item of todos) if (!item.done) count += 1;
	return count;
}
function snapshotOf(domain, workspaceId) {
	const globalScope = domain.global.get();
	const table = domain.table("workspaces");
	const workspaceScope = workspaceId !== null ? table.get(workspaceId) : void 0;
	return {
		global: copyScope(globalScope),
		workspace: workspaceScope === void 0 ? null : copyScope(workspaceScope),
		counts: {
			globalOpen: openCount(globalScope.todos),
			workspaceOpen: workspaceScope === void 0 ? 0 : openCount(workspaceScope.todos)
		}
	};
}
function apply(ctx, config = {}) {
	applyLivefeedHost(ctx);
	const webServer = ctx.webServer;
	const storageDomain = ctx.get("storageDomain");
	if (storageDomain === void 0) {
		ctx.logger.error("[dsh-notes] storageDomain unavailable; notes API disabled");
		return;
	}
	let chain = Promise.resolve();
	function enqueue(job) {
		const result = chain.then(job);
		chain = result.then(() => {}, () => {});
		return result;
	}
	const undoMap = /* @__PURE__ */ new Map();
	function undoKeyOf(scope, workspaceId) {
		return scope === "global" ? "global" : `workspace:${workspaceId}`;
	}
	function recordUndo(key, removed) {
		undoMap.delete(key);
		undoMap.set(key, removed);
		while (undoMap.size > UNDO_CAP) {
			const oldest = undoMap.keys().next().value;
			undoMap.delete(oldest);
		}
	}
	function clearUndo(key) {
		undoMap.delete(key);
	}
	const domainPromise = storageDomain.open(notesDomainSpec).catch((error) => {
		ctx.logger.error(`[dsh-notes] failed to open notes domain: ${String(error)}`);
		return null;
	});
	ctx.effect(() => () => {
		domainPromise.then((domain) => {
			if (domain !== null) return domain.close();
		});
	});
	async function requireDomain() {
		const domain = await domainPromise;
		if (domain === null) throw new Error("storage-unavailable");
		return domain;
	}
	function parseScope(body) {
		const scope = body.scope;
		if (scope === "global") return {
			scope,
			workspaceId: null
		};
		if (scope === "workspace") {
			const workspaceId = typeof body.workspaceId === "string" && body.workspaceId !== "" ? body.workspaceId : null;
			if (workspaceId === null) return { error: "bad-args" };
			return {
				scope,
				workspaceId
			};
		}
		return { error: "bad-args" };
	}
	function mutate(scope, workspaceId, fn) {
		return enqueue(async () => {
			const domain = await requireDomain();
			if (scope === "global") {
				const next = fn(copyScope(domain.global.get()));
				await domain.global.set(next);
				return snapshotOf(domain, workspaceId);
			}
			const table = domain.table("workspaces");
			const current = table.get(workspaceId);
			const next = fn(current === void 0 ? emptyScope() : copyScope(current));
			await table.put(workspaceId, next);
			return snapshotOf(domain, workspaceId);
		});
	}
	function pushTodo(todos, text, detail) {
		const trimmed = String(text).trim().slice(0, TODO_TEXT_MAX);
		if (trimmed === "") return todos;
		const trimmedDetail = typeof detail === "string" ? detail.slice(0, DETAIL_MAX) : "";
		const now = Date.now();
		const item = {
			id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
			text: trimmed,
			done: false,
			pinned: false,
			...trimmedDetail === "" ? {} : { detail: trimmedDetail },
			createdAt: now,
			updatedAt: now
		};
		return [...todos, item];
	}
	function applyAction(action, body) {
		const parsed = parseScope(body);
		if (parsed.error !== void 0) return Promise.resolve({ error: parsed.error });
		const { scope, workspaceId } = parsed;
		const undoKey = undoKeyOf(scope, workspaceId);
		switch (action) {
			case "add":
				if (typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: pushTodo(current.todos, body.text, typeof body.detail === "string" ? body.detail : "")
				}));
			case "toggle":
				if (typeof body.id !== "string" || typeof body.done !== "boolean") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: current.todos.map((item) => item.id === body.id ? {
						...item,
						done: body.done,
						updatedAt: Date.now()
					} : item)
				}));
			case "edit": {
				if (typeof body.id !== "string" || typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				const text = body.text.trim().slice(0, TODO_TEXT_MAX);
				if (text === "") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				const hasDetail = typeof body.detail === "string";
				const detail = hasDetail ? body.detail.slice(0, DETAIL_MAX) : void 0;
				return mutate(scope, workspaceId, (current) => ({
					...current,
					todos: current.todos.map((item) => {
						if (item.id !== body.id) return item;
						const next = {
							...item,
							text,
							updatedAt: Date.now()
						};
						if (hasDetail) if (detail === "") delete next.detail;
						else next.detail = detail;
						return next;
					})
				}));
			}
			case "delete":
				if (typeof body.id !== "string") return Promise.resolve({ error: "bad-args" });
				return mutate(scope, workspaceId, (current) => {
					const removed = [];
					const indices = [];
					const todos = current.todos.filter((item, index) => {
						if (item.id === body.id) {
							removed.push(item);
							indices.push(index);
							return false;
						}
						return true;
					});
					if (removed.length > 0) recordUndo(undoKey, {
						removed,
						indices
					});
					return {
						...current,
						todos
					};
				});
			case "pin":
				if (typeof body.id !== "string" || typeof body.pinned !== "boolean") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => {
					let found = false;
					const todos = current.todos.map((item) => {
						if (item.id !== body.id) return item;
						found = true;
						return {
							...item,
							pinned: body.pinned,
							updatedAt: Date.now()
						};
					});
					if (!found) return current;
					const item = todos.find((it) => it.id === body.id);
					return {
						...current,
						todos: body.pinned ? [item, ...todos.filter((it) => it.id !== body.id)] : todos
					};
				});
			case "reorder":
				if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== "string")) return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => {
					const byId = new Map(current.todos.map((item) => [item.id, item]));
					const ordered = [];
					for (const id of body.orderedIds) {
						const item = byId.get(id);
						if (item !== void 0) {
							ordered.push(item);
							byId.delete(id);
						}
					}
					for (const item of byId.values()) ordered.push(item);
					return {
						...current,
						todos: ordered
					};
				});
			case "set-memo":
				if (typeof body.text !== "string") return Promise.resolve({ error: "bad-args" });
				clearUndo(undoKey);
				return mutate(scope, workspaceId, (current) => ({
					...current,
					memo: body.text.slice(0, MEMO_MAX)
				}));
			case "undo-delete": {
				const record = undoMap.get(undoKey);
				if (record === void 0) return Promise.resolve({ error: "no-undo" });
				undoMap.delete(undoKey);
				return mutate(scope, workspaceId, (current) => {
					const todos = [...current.todos];
					for (let i = 0; i < record.removed.length; i += 1) {
						const at = Math.min(record.indices[i], todos.length);
						todos.splice(at, 0, record.removed[i]);
					}
					return {
						...current,
						todos
					};
				});
			}
			default: return Promise.resolve({ error: "bad-args" });
		}
	}
	function sendJson(res, status, payload) {
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		});
		res.end(JSON.stringify(payload));
	}
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: ROUTE_PATH,
		handler: async (req, res) => {
			if (req.method === "GET" || req.method === "HEAD") {
				const workspaceId = new URL(req.url ?? "/", "http://local").searchParams.get("workspaceId");
				try {
					sendJson(res, 200, {
						ok: true,
						...snapshotOf(await requireDomain(), workspaceId !== null && workspaceId !== "" ? workspaceId : null)
					});
				} catch (error) {
					sendJson(res, 503, {
						ok: false,
						error: "storage-unavailable"
					});
				}
				return;
			}
			if (req.method !== "POST") {
				sendJson(res, 405, {
					ok: false,
					error: "METHOD"
				});
				return;
			}
			let body;
			try {
				body = await readJson(req);
			} catch {
				sendJson(res, 400, {
					ok: false,
					error: "bad-json"
				});
				return;
			}
			const action = typeof body.action === "string" ? body.action : "";
			try {
				const result = await applyAction(action, body);
				if (result.error !== void 0) {
					sendJson(res, result.error === "no-undo" ? 404 : 400, {
						ok: false,
						error: result.error
					});
					return;
				}
				sendJson(res, 200, {
					ok: true,
					state: result
				});
			} catch (error) {
				ctx.logger.warn(`[dsh-notes] action '${action}' failed: ${String(error)}`);
				sendJson(res, 503, {
					ok: false,
					error: "storage-unavailable"
				});
			}
		}
	}), "dsh-notes: route");
}
function readJson(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 256 * 1024) {
				reject(/* @__PURE__ */ new Error("payload too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
//#endregion
export { apply, inject, name };
