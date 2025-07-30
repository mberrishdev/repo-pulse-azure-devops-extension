import "es6-promise/auto";
import * as React from "react";
import * as ReactDOM from "react-dom";
import "./Common.scss";

export function showRootComponent(component: React.ReactElement<unknown>) {
    ReactDOM.render(component, document.getElementById("root"));
}