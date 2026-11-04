        states: State {
            when: root.launcherZoomActive
            PropertyChanges {
                target: curtain
                topLeft: Qt.point(root.zoomLeft, root.zoomTop)
                topRight: Qt.point(root.zoomRight, root.zoomTop)
                bottomLeft: Qt.point(root.zoomLeft, root.zoomBottom)
                bottomRight: Qt.point(root.zoomRight, root.zoomBottom)
                controlLeftTop: Qt.point(root.zoomLeft, root.zoomTop + (root.zoomBottom - root.zoomTop) / 3)
                controlLeftBottom: Qt.point(root.zoomLeft, root.zoomTop + 2 * (root.zoomBottom - root.zoomTop) / 3)
                controlRightTop: Qt.point(root.zoomRight, root.zoomTop + (root.zoomBottom - root.zoomTop) / 3)
                controlRightBottom: Qt.point(root.zoomRight, root.zoomTop + 2 * (root.zoomBottom - root.zoomTop) / 3)
                controlTopLeft: Qt.point(root.zoomLeft + (root.zoomRight - root.zoomLeft) / 3, root.zoomTop)
                controlTopRight: Qt.point(root.zoomLeft + 2 * (root.zoomRight - root.zoomLeft) / 3, root.zoomTop)
                controlBottomLeft: Qt.point(root.zoomLeft + (root.zoomRight - root.zoomLeft) / 3, root.zoomBottom)
                controlBottomRight: Qt.point(root.zoomLeft + 2 * (root.zoomRight - root.zoomLeft) / 3, root.zoomBottom)
            }
        }
