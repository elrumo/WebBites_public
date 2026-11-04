<template>
    <a
        class="movie-cast-item"
        :href="`https://www.themoviedb.org/person/${castProfile.id}`"
        target="_blank"
    >
        <img
            :src="profilePic"
            :alt="castProfile.name"
            class="movie-cast-image"
        />

        <div class="movie-cast-body">
            <h6 class="_margin:0">
                {{ castProfile.name }}
            </h6>

            <span>
                {{ castProfile.character ? castProfile.character : castProfile.job }}
            </span>
        </div>
    </a>
</template>

<script>
import "vue3-circle-progress/dist/circle-progress.css";
import CircleProgress from "vue3-circle-progress";

export default {
    name: 'MovieCastProfile',
    
    components: {
        CircleProgress
    },

    props:{
        castProfile: {
            type: Object,
            default: {}
        }
    },
    
    async mounted() {
    },
    
    unmounted() {
    },

    computed: {
         profilePic() {
            return this.castProfile.profile_path ? `https://image.tmdb.org/t/p/w500${this.castProfile.profile_path}` : 'https://placehold.co/100x133?text=Image'
        },
    }
}
</script>
