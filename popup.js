// ------------------------------------------------------------
// CHANGE THESE FOUR VALUES TO YOUR FIXED DROPDOWN VALUES
// ------------------------------------------------------------
// The "value" should match the visible dropdown text as closely as possible.
//
// Example:
// value: "03 - In Progress"
// value: "Production Issue"
// value: "John Smith"
// ------------------------------------------------------------

const FIELD_UPDATES = [
  {
    labels: ["Assigned to", "Assigned To"],
    value: "YOUR_ASSIGNEE_USERNAME"
  },
  {
    labels: ["Status"],
    value: "Closed"
  },
  {
    labels: ["Category"],
    value: "Data Audit"
  },
  {
    labels: ["CSQA Owner", "CSQA Owners"],
    value: "YOUR_ASSIGNEE_USERNAME"
  }
];

// Optional filter text.
// If your ticket URL always contains edit_bug.aspx, leave this as-is.
// This does not hide other tabs; it only helps sort likely ticket tabs.
const TAB_FILTER_TEXT = "edit_bug.aspx";

const tabsSelect = document.getElementById("tabs");
const statusBox = document.getElementById("status");
const currentTabBox = document.getElementById("currentTab");

document.getElementById("reloadTabs").addEventListener("click", loadTabs);
document.getElementById("fillOnly").addEventListener("click", () => runUpdater(false));
document.getElementById("fillAndSubmit").addEventListener("click", () => runUpdater(true));

document.addEventListener("DOMContentLoaded", loadTabs);

async function loadTabs() {
  statusBox.textContent = "Loading tabs...";

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const allTabs = await chrome.tabs.query({});

  tabsSelect.innerHTML = "";

  const usableTabs = allTabs.filter(tab => {
    if (!tab.url) return false;
    return /^https?:\/\//i.test(tab.url);
  });

  if (!usableTabs.length) {
    currentTabBox.textContent = "Current tab: No usable web page selected.";
    statusBox.textContent = "No usable website tabs found.";
    return;
  }

  const activeTabIsUsable =
    activeTab &&
    activeTab.url &&
    /^https?:\/\//i.test(activeTab.url);

  if (activeTabIsUsable) {
    currentTabBox.textContent = `Current tab: ${activeTab.title || activeTab.url}`;
  } else {
    currentTabBox.textContent = "Current tab: This page cannot be edited by the extension.";
  }

  const sortedTabs = [];

  // Put the current active tab first.
  if (activeTabIsUsable) {
    const current = usableTabs.find(tab => tab.id === activeTab.id);
    if (current) {
      sortedTabs.push(current);
    }
  }

  // Then put likely ticket tabs.
  for (const tab of usableTabs) {
    const alreadyAdded = sortedTabs.some(existing => existing.id === tab.id);
    if (alreadyAdded) continue;

    const looksLikeTicket =
      String(tab.url || "").toLowerCase().includes(TAB_FILTER_TEXT.toLowerCase()) ||
      String(tab.title || "").toLowerCase().includes("ticket") ||
      String(tab.title || "").toLowerCase().includes("bug");

    if (looksLikeTicket) {
      sortedTabs.push(tab);
    }
  }

  // Then put all remaining usable tabs.
  for (const tab of usableTabs) {
    const alreadyAdded = sortedTabs.some(existing => existing.id === tab.id);
    if (!alreadyAdded) {
      sortedTabs.push(tab);
    }
  }

  for (const tab of sortedTabs) {
    const option = document.createElement("option");
    option.value = String(tab.id);

    const isCurrentTab = activeTabIsUsable && tab.id === activeTab.id;

    option.textContent = isCurrentTab
      ? `Current tab — ${tab.title || "Untitled"}`
      : `${tab.title || "Untitled"} — ${tab.url}`;

    if (isCurrentTab) {
      option.selected = true;
    }

    tabsSelect.appendChild(option);
  }

  statusBox.textContent = activeTabIsUsable
    ? "Current tab is selected. You can choose another tab from the dropdown."
    : "Choose a tab from the dropdown.";
}

async function runUpdater(shouldSubmit) {
  const tabId = Number(tabsSelect.value);

  if (!tabId) {
    statusBox.textContent = "Please select a tab first.";
    return;
  }

  statusBox.textContent = shouldSubmit
    ? "Updating fields and pressing Update..."
    : "Updating fields only...";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: updateTicketPage,
      args: [FIELD_UPDATES, shouldSubmit]
    });

    const result = results && results[0] && results[0].result;

    if (!result) {
      statusBox.textContent = "No result returned from the selected tab.";
      return;
    }

    statusBox.textContent = result.messages.join("\n");
  } catch (err) {
    statusBox.textContent =
      "Error:\n" +
      err.message +
      "\n\nMake sure the selected tab is a normal website page, not a Chrome settings page or internal browser page.";
  }
}

// This function is injected into the ticket page.
function updateTicketPage(fieldUpdates, shouldSubmit) {
  const messages = [];

  function normalize(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[:*]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isUsableControl(el) {
    if (!el) return false;

    const tag = el.tagName.toLowerCase();

    if (!["select", "input", "textarea"].includes(tag)) {
      return false;
    }

    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();

      if (["hidden", "submit", "button", "reset", "checkbox", "radio"].includes(type)) {
        return false;
      }
    }

    return true;
  }

  function getControlFromRow(labelElement) {
    const row = labelElement.closest("tr");

    if (!row) {
      return null;
    }

    const labelCell = labelElement.closest("td, th");
    const cells = Array.from(row.children);
    const labelIndex = cells.indexOf(labelCell);

    // Prefer controls in cells after the label cell.
    for (let i = Math.max(labelIndex + 1, 0); i < cells.length; i++) {
      const control = cells[i].querySelector("select, input, textarea");

      if (isUsableControl(control)) {
        return control;
      }
    }

    // Fallback: any usable control in the same row.
    const controls = Array.from(row.querySelectorAll("select, input, textarea"))
      .filter(isUsableControl);

    return controls[0] || null;
  }

  function findControlByLabel(possibleLabels) {
    const wantedLabels = possibleLabels.map(normalize);

    // First, try real <label for="..."> elements.
    for (const label of document.querySelectorAll("label")) {
      const text = normalize(label.textContent);

      if (wantedLabels.includes(text) && label.htmlFor) {
        const control = document.getElementById(label.htmlFor);

        if (isUsableControl(control)) {
          return control;
        }
      }
    }

    // Then try old-style table/form labels:
    // <td>Assigned to:</td><td><select>...</select></td>
    const candidates = Array.from(document.querySelectorAll("td, th, label, span, div"));

    for (const el of candidates) {
      const text = normalize(el.textContent);

      if (!text) {
        continue;
      }

      const isMatch = wantedLabels.some(wanted =>
        text === wanted ||
        text.startsWith(wanted + " ")
      );

      if (!isMatch) {
        continue;
      }

      const control = getControlFromRow(el);

      if (control) {
        return control;
      }
    }

    return null;
  }

  function setSelectValue(select, desiredValue) {
    const wanted = normalize(desiredValue);
    const options = Array.from(select.options);

    const exactText = options.find(option => normalize(option.textContent) === wanted);
    const exactValue = options.find(option => normalize(option.value) === wanted);
    const partialText = options.find(option => normalize(option.textContent).includes(wanted));

    const option = exactText || exactValue || partialText;

    if (!option) {
      const available = options
        .map(option => option.textContent.trim())
        .filter(Boolean)
        .join(", ");

      throw new Error(
        `Could not find dropdown option "${desiredValue}". Available options: ${available}`
      );
    }

    select.value = option.value;

    // Trigger page JavaScript that listens for field changes.
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    return option.textContent.trim();
  }

  function setControlValue(control, value) {
    const tag = control.tagName.toLowerCase();

    if (tag === "select") {
      return setSelectValue(control, value);
    }

    control.value = value;

    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));

    return value;
  }

  function clickUpdateButton() {
    const buttons = Array.from(
      document.querySelectorAll("input[type='submit'], input[type='button'], button")
    );

    const updateButton = buttons.find(button => {
      const text = [
        button.value,
        button.textContent,
        button.name,
        button.id
      ].join(" ");

      return /update|save|submit|ok/i.test(text);
    });

    if (updateButton) {
      updateButton.click();

      return "Clicked button: " + (
        updateButton.value ||
        updateButton.textContent ||
        updateButton.name ||
        updateButton.id ||
        "Update"
      ).trim();
    }

    const form = document.querySelector("form");

    if (!form) {
      throw new Error("Could not find an Update button or form to submit.");
    }

    if (form.requestSubmit) {
      form.requestSubmit();
    } else {
      form.submit();
    }

    return "Submitted the form directly because no Update button was found.";
  }

  try {
    for (const update of fieldUpdates) {
      const control = findControlByLabel(update.labels);

      if (!control) {
        throw new Error(`Could not find field with label: ${update.labels.join(" / ")}`);
      }

      const actualValue = setControlValue(control, update.value);

      messages.push(`Updated ${update.labels[0]} -> ${actualValue}`);
    }

    if (shouldSubmit) {
      messages.push(clickUpdateButton());
    } else {
      messages.push("Fill only completed. The ticket was not submitted.");
    }

    return {
      ok: true,
      messages
    };
  } catch (err) {
    messages.push("FAILED: " + err.message);

    return {
      ok: false,
      messages
    };
  }
}
