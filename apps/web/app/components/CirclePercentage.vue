<template>
    <div class="circle-progress">
        <span class="percentage">
            {{ toPercentage }}
            <sup>%</sup>
        </span>
        <circle-progress
            :size="60"
            :border-width="5"
            :border-bg-width="5"
            :percent="toPercentage"
            :fill-color="circleColor"
            empty-color="rgba(0,0,0,0.3)"
        />
    </div>
</template>

<script>
import "vue3-circle-progress/dist/circle-progress.css";
import CircleProgress from "vue3-circle-progress";

export default {
    name: 'CirclePercentage',
    
    components: {
        CircleProgress
    },

    props:{
        percentage: {
            type: Number,
            default: 0
        }
    },
    
    async mounted() {
    },
    
    unmounted() {
    },

    computed: {
         toPercentage() {
            if (this.percentage) {
                return Math.round(this.percentage * 10)
            } else {
                return 0
            }
        },

        circleColor() {
            const percentage = this.toPercentage;
            if (percentage < 50) {
                return '#FF6B6B'; // Light red
            } else if (percentage < 60) {
                return '#FFE66D'; // Light yellow
            } else if (percentage < 70) {
                return '#4ECDC4'; // Light orange
            } else {
                return '#48BB78'; // Light green
            }
        },
    }
}
</script>
