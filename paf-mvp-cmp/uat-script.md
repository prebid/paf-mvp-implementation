# Introduction

This document contains common User Acceptance Test (UAT) scripts that can be
used to verify the functionality of the CMP user interface and data model. These
scripts do not directly test the underlying data storage layer. They are
intended as a manual gross error check when making general changes. Specific
scripts should be used for specific functional changes.

In this document “Global” refers to OneKey scope, and “Local” to the specific
web site only.

# Scripts

The following scripts always start with a desktop or laptop English language web
browser in private browsing mode with no cookies present from any web site and
entering the URL `https://www.pafdemopublisher.com/`.

## Personalized Marketing Global - Full Test

Checks the common OneKey global scope scenarios.

-   Select the OneKey logo in the top left-hand corner and verify that the
    “Learn more” card is displayed.
-   Select the “Back” button to return to the settings card.
-   Select the option “turn on personalized marketing”.
-   Check that the “Your browsing ID” value is displayed immediately. Record the
    value shown to the right.
-   Select “Save” button.
-   Refresh the web browser (typically using Ctrl + F5 keyboard shortcut).
-   Check that the snackbar appears at the bottom of the page.
-   Check that the snackbar disappears after approximately 5 seconds.
-   Refresh the web browser.
-   Select the “Review your preferences” link from the snackbar before it
    disappears.
-   Verify that “turn on personalized marketing” is selected.
-   Verify that the “Your browsing ID” matches the value shown earlier.
-   Select the “Your browsing ID” text and verify that the value changes and the
    “Save” button becomes enabled. Record the new value shown.
-   Select the “Save” button.
-   When the snackbar reappears select “Review your preference”.
-   Verify that the new value for “Your browsing ID” is displayed.

### Variations

-   Replace “personalized” with “standard”.

![Personalized Marketing Global Full Test - Recording](images/Personalized%20Marketing%20Global%20Full%20Test.gif)

## Refuse All

Checks that the refuse all option works.

-   Select the “Refuse All” button.
-   Refresh the web browser.
-   Verify that no OneKey snackbar is displayed.

## Personalized Marketing Local – Customized

Checks the customized this site only data is retained and displayed correctly.

-   Select the option “turn on personalized marketing”.
-   Select “customize your experience”.
-   Verify that the heading of the card displays “Personalized marketing”.
-   Verify the two toggles at the bottom of the card are set to on and can’t be
    turned off.
-   Change the “Measure content performance” toggle to off.
-   Verify that the heading of the card displays “Standard marketing”.
-   Change the “Measure content performance” toggle to on.
-   Verify that the heading of the card displays “Personalized marketing”.
-   Select the “Back” button.
-   Verify that the “Ask for preferences on each site I visit” toggle is off.
-   Select “customize your experience”.
-   Change the “Measure ad performance” toggle to off.
-   Verify the heading of the card displays “Site specific marketing”.
-   Select the “Back” button.
-   Verify that the “Ask for preferences on each site I visit” toggle is on and
    cannot be changed to off.
-   Select the “Save” button.
-   Verify that the snackbar does not appear.
-   Scroll to the bottom of the web page and select “Marketing preferences”.
-   Verify that the “Ask for preferences on each site I visit” toggle is on and
    cannot be changed to off.
-   Select “customize your experience”.
-   Verify that only the “Measure ad performance” toggle is set to off.

### Variations

-   Replace “personalized” with “standard”.
-   Use combinations of other customized toggle options.
-   Cancel the dialogue to verify that changes are not saved.

![Personalized Marketing Local Customized - Recording](images/Personalized%20Marketing%20Local%20Customized.gif)

## Snackbar Global Personalized to Standard Change

Checks that the user can change from personalized to standard marketing without
the ID being reset.

-   Select the option “turn on personalized marketing”.
-   Check that the “Your browsing ID” value is displayed immediately. Record the
    value shown to the right.
-   Select “Save” button.
-   Refresh the web browser.
-   Select the “Review your preferences” link from the snackbar before it
    disappears.
-   Select the option “turn on standard marketing”.
-   Select “Save” button.
-   Refresh the web browser.
-   Select the “Review your preferences” link from the snackbar before it
    disappears.
-   Check that “turn on standard marketing” is now the selected option.
-   Check that the “Your browsing ID” value is the same that displayed earlier.

![Snackbar Global Personalized to Standard Change - Recording](images/Snackbar%20Global%20Personalized%20to%20Standard%20Change.gif)