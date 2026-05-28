import { html } from "htm/preact";
import { connect } from "unistore/preact";
import { getFiltered } from "../store/selectors.js";
import style from "./app.css" with { type: "css" };
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { Todo } from "./todo.js";
import pkg from "../package.json" with { type: "json" };

document.adoptedStyleSheets.push(style);

const mapStateToProps = (state) => ({
  filtered: getFiltered(state),
});

export const App = connect(mapStateToProps)(
  ({ filtered }) => html`
    <div class="app__container">
      <section class="app__content">
        <${Header} />
        <section class="app__todos">
          <ul>
            ${filtered.map(
              (todo) => html`<${Todo} key=${todo.uid} todo=${todo} />`,
            )}
          </ul>
        </section>
        <${Footer} />
      </section>
      <footer class="app__info">
        <p>Double-click to edit a todo. v${pkg.version}</p>
        <p>Written by <a href="https://djalmajr.dev">Djalma Jr.</a></p>
      </footer>
    </div>
  `,
);
