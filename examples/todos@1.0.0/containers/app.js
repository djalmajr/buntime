import { html } from "htm/preact";
import { connect } from "unistore/preact";
import pkg from "../package.json" with { type: "json" };
import { getFiltered } from "../store/selectors.js";
import style from "./app.css" with { type: "css" };
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Todo } from "./todo.js";

document.adoptedStyleSheets.push(style);

const mapStateToProps = (state) => ({
  filtered: getFiltered(state),
  loading: state.loading,
});

export const App = connect(mapStateToProps)(({ filtered, loading }) => {
  return html`
    <div class="app__container">
      <section class="app__content">
        <${Header} />
        <section class="app__todos">
          ${
            loading
              ? html`<div class="app__loader"><div class="app__loader__spinner"></div></div>`
              : html`<ul>
                ${filtered.map((todo) => html`<${Todo} key=${todo.uid} todo=${todo} />`)}
              </ul>`
          }
        </section>
        <${Footer} />
      </section>
      <footer class="app__info">
        <p>Double-click to edit a todo. v${pkg.version}</p>
        <p>Written by <a href="https://user.dev">Djalma Jr.</a></p>
      </footer>
    </div>
  `;
});
