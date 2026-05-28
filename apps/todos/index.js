import { html, render } from "htm/preact";
import { Provider } from "unistore/preact";
import { App } from "./containers/app.js";
import { store } from "./store/store.js";

render(html`<${Provider} store=${store}><${App} /><//>`, document.querySelector("#root"));
